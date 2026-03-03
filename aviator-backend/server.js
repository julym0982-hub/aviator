// ==================== လိုအပ်သော module များခေါ်ယူခြင်း ====================
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const adminRoutes = require('./routes/admin');
const User = require('./models/User');

// dotenv ကိုခေါ်သုံးရန် (Render က Environment Variable ကိုဖတ်နိုင်ရန်)
require('dotenv').config();

// ==================== Express App နှင့် Server ဖန်တီးခြင်း ====================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // လက်ရှိတွင် အားလုံးခွင့်ပြုထား (production တွင် ကန့်သတ်သင့်)
    methods: ["GET", "POST"]
  }
});

// Middleware များ
app.use(cors());
app.use(express.json());
app.use('/admin', adminRoutes); // Admin route ကို ထည့်သွင်းခြင်း

// ==================== MongoDB ချိတ်ဆက်ခြင်း (Render Environment Variable သုံး) ====================
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MongoDB URI ကို Environment Variable ထဲတွင် ထည့်ပေးရန်လိုအပ်ပါသည်။');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB ချိတ်ဆက်မှု အောင်မြင်ပါသည်။');
}).catch(err => {
  console.error('MongoDB ချိတ်ဆက်မှု မအောင်မြင်ပါ။', err);
  process.exit(1); // ချိတ်ဆက်မရပါက server ရပ်ပစ်မည်
});

// ==================== ဂိမ်း၏ state များသိမ်းဆည်းရန် ====================
const gameState = {
  isWaiting: true,           // စောင့်ဆိုင်းနေသည့် အခြေအနေ (ပွဲမစမီ)
  isPlaying: false,          // ဂိမ်းစတင်နေပြီလား
  currentMultiplier: 1.00,   // လက်ရှိ multiplier တန်ဖိုး
  crashPoint: 1.00,          // ပေါက်ကွဲမည့် multiplier
  gameId: null,              // ပွဲစဉ် ID (ထူးခြားရန်)
  waitingTime: 5,            // စောင့်ဆိုင်းချိန် ၅ စက္ကန့်
  waitingCounter: 0,         // စောင့်ဆိုင်းချိန် ရေတွက်ရန်
  activeBets: new Map()      // လက်ရှိထိုးထားသော လောင်းကြေးများ (key: userId, value: { betAmount, socketId })
};

// ==================== ဂိမ်းစက်နည်းဗျူဟာ (Game Engine) ====================

/**
 * ပွဲသစ်စတင်ရန် ပြင်ဆင်ခြင်း
 */
function prepareNewGame() {
  gameState.isWaiting = true;
  gameState.isPlaying = false;
  gameState.waitingCounter = gameState.waitingTime;
  gameState.currentMultiplier = 1.00;
  // ပွဲစဉ် ID အသစ်ထုတ်ခြင်း (timestamp + random)
  gameState.gameId = `game_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  
  // ပွဲစဉ်အသစ်အတွက် active bets များကို ရှင်းလင်းခြင်း
  gameState.activeBets.clear();
  
  console.log(`[${new Date().toISOString()}] ပွဲအသစ် ${gameState.gameId} ပြင်ဆင်ပြီး။ စောင့်ဆိုင်းချိန် ${gameState.waitingTime} စက္ကန့်။`);
  
  // Client အားလုံးကို စောင့်ဆိုင်းနေသည့် အခြေအနေ အသိပေးခြင်း
  io.emit('waiting', { 
    message: 'ပွဲအသစ်စတင်ရန် ပြင်ဆင်နေသည်။', 
    waitingTime: gameState.waitingTime,
    gameId: gameState.gameId
  });
}

/**
 * ပေါက်ကွဲမည့် multiplier ကို ကျပန်းထုတ်ခြင်း
 * @returns {number} 1.00 မှ 10.00 ကြား random multiplier
 */
function generateCrashPoint() {
  // Crash point ကို ကျပန်းထုတ်ခြင်း (1.00 မှ 10.00 ကြား)
  // ဖြစ်နိုင်ခြေ များသော ဂိမ်းမျိုးဖြစ်အောင် နည်းနည်းချိန်ညှိနိုင်သည်။
  return parseFloat((Math.random() * 9 + 1).toFixed(2)); // 1.00 မှ 10.00
}

/**
 * ဂိမ်းစတင်ခြင်း (playing state)
 */
function startGame() {
  gameState.isWaiting = false;
  gameState.isPlaying = true;
  gameState.crashPoint = generateCrashPoint();
  gameState.currentMultiplier = 1.00;
  
  console.log(`[${new Date().toISOString()}] ပွဲ ${gameState.gameId} စတင်သည်။ ပေါက်ကွဲမည့် multiplier: ${gameState.crashPoint}x`);
  
  // Client များကို game started အကြောင်းကြားခြင်း
  io.emit('gameStarted', { 
    gameId: gameState.gameId,
    initialMultiplier: gameState.currentMultiplier 
  });
  
  // Multiplier update စတင်ရန် updateMultiplier ကိုခေါ်မည်
  updateMultiplier();
}

/**
 * Multiplier ကို 50ms တိုင်း update လုပ်ပြီး client များသို့ပို့ခြင်း
 */
function updateMultiplier() {
  if (!gameState.isPlaying) return; // ဂိမ်းမကစားတော့ပါက ရပ်ပစ်မည်
  
  // Multiplier တိုးတက်နှုန်း (ပုံမှန် 0.01 နှုန်း)
  gameState.currentMultiplier = parseFloat((gameState.currentMultiplier + 0.01).toFixed(2));
  
  // Client များသို့ multiplier update ပို့ခြင်း
  io.emit('multiplierUpdate', { 
    multiplier: gameState.currentMultiplier,
    gameId: gameState.gameId
  });
  
  // Crash point ရောက်ပြီလား စစ်ဆေးခြင်း
  if (gameState.currentMultiplier >= gameState.crashPoint) {
    // ပေါက်ကွဲခြင်း (Crash)
    gameState.isPlaying = false;
    console.log(`[${new Date().toISOString()}] ပွဲ ${gameState.gameId} ပေါက်ကွဲသည်။ Crash at ${gameState.currentMultiplier}x`);
    
    // လက်ရှိထိုးထားသော လောင်းကြေးများကို ရှုံးသည် သတ်မှတ်ပြီး history သိမ်းမည်
    handleGameCrash();
    
    // Client များကို crash event ပို့ခြင်း
    io.emit('gameCrashed', { 
      crashMultiplier: gameState.currentMultiplier,
      gameId: gameState.gameId
    });
    
    // နောက်ပွဲအတွက် စောင့်ဆိုင်းချိန် စတင်မည်
    setTimeout(() => {
      prepareNewGame();
      startWaitingCountdown();
    }, 1000); // ၁ စက္ကန့်အကြာမှ စောင့်ဆိုင်းချိန်စတင်မည် (အကြောင်းကြားချက်များပို့ရန်)
    
    return;
  }
  
  // နောက် update ကို 50ms အကြာတွင် ထပ်ခေါ်မည်
  setTimeout(updateMultiplier, 50);
}

/**
 * စောင့်ဆိုင်းချိန် countdown လုပ်ခြင်း
 */
function startWaitingCountdown() {
  const interval = setInterval(() => {
    if (!gameState.isWaiting) {
      clearInterval(interval);
      return;
    }
    
    gameState.waitingCounter--;
    
    // Client များကို waiting time update ပို့ခြင်း
    io.emit('waitingUpdate', { 
      remainingTime: gameState.waitingCounter,
      gameId: gameState.gameId
    });
    
    if (gameState.waitingCounter <= 0) {
      clearInterval(interval);
      // စောင့်ဆိုင်းချိန်ပြည့်ပြီ ဂိမ်းစတင်မည်
      startGame();
    }
  }, 1000); // ၁ စက္ကန့်တိုင်း update
}

/**
 * ဂိမ်းပေါက်ကွဲသွားသောအခါ လက်ရှိထိုးထားသော လောင်းကြေးများကို ရှုံးသည် သတ်မှတ်ခြင်း
 */
async function handleGameCrash() {
  // activeBets ထဲရှိ လူတိုင်းအတွက် ရှုံးသည် history သိမ်းမည်
  for (let [userId, betInfo] of gameState.activeBets.entries()) {
    try {
      const user = await User.findOne({ userId });
      if (user) {
        // လောင်းကြေး ရှုံးသည် အဖြစ် history ထဲထည့်မည်
        user.history.push({
          gameId: gameState.gameId,
          betAmount: betInfo.betAmount,
          cashoutMultiplier: gameState.currentMultiplier,
          result: 'loss'
        });
        await user.save();
        
        // သုံးစွဲသူအား ရှုံးကြောင်း အသိပေးရန် (socket)
        const socket = io.sockets.sockets.get(betInfo.socketId);
        if (socket) {
          socket.emit('betResult', {
            result: 'loss',
            amount: betInfo.betAmount,
            multiplier: gameState.currentMultiplier
          });
        }
      }
    } catch (error) {
      console.error(`User ${userId} history update error:`, error);
    }
  }
}

// ==================== Socket.io Connection Handling ====================
io.on('connection', (socket) => {
  console.log(`Client ချိတ်ဆက်လာသည်။ Socket ID: ${socket.id}`);

  // ချိတ်ဆက်လာသော client အား လက်ရှိဂိမ်းအခြေအနေ ပို့ပေးခြင်း
  socket.emit('currentGameState', {
    isWaiting: gameState.isWaiting,
    isPlaying: gameState.isPlaying,
    currentMultiplier: gameState.currentMultiplier,
    gameId: gameState.gameId,
    waitingTime: gameState.waitingCounter
  });

  /**
   * လောင်းကြေးထိုးခြင်း event
   * data: { userId, betAmount }
   */
  socket.on('placeBet', async (data) => {
    try {
      const { userId, betAmount } = data;
      
      // ဂိမ်းသည် စောင့်ဆိုင်းနေသည့်အချိန်တွင်သာ လောင်းကြေးလက်ခံမည်
      if (!gameState.isWaiting) {
        return socket.emit('error', { message: 'လောင်းကြေးထိုးရန် အချိန်မဟုတ်ပါ။' });
      }
      
      // သုံးစွဲသူရှာဖွေခြင်း
      const user = await User.findOne({ userId });
      if (!user) {
        return socket.emit('error', { message: 'သုံးစွဲသူ မတွေ့ရှိပါ။' });
      }
      
      // လက်ကျန်ငွေ လုံလောက်မှုစစ်ဆေးခြင်း
      if (user.balance < betAmount) {
        return socket.emit('error', { message: 'လက်ကျန်ငွေ မလုံလောက်ပါ။' });
      }
      
      // လက်ရှိတွင် ထိုးပြီးသားလား စစ်ဆေးခြင်း (တစ်ယောက်တစ်ပွဲ တစ်ကြိမ်သာထိုးခွင့်ပြုမည်)
      if (gameState.activeBets.has(userId)) {
        return socket.emit('error', { message: 'သင်သည် ဤပွဲတွင် လောင်းကြေးထိုးပြီးပါပြီ။' });
      }
      
      // လက်ကျန်ငွေမှ လောင်းကြေးနုတ်ခြင်း
      user.balance -= betAmount;
      await user.save();
      
      // activeBets ထဲသို့ထည့်ခြင်း
      gameState.activeBets.set(userId, {
        betAmount: betAmount,
        socketId: socket.id
      });
      
      // သုံးစွဲသူအား အောင်မြင်ကြောင်း အကြောင်းကြားခြင်း
      socket.emit('betPlaced', {
        success: true,
        betAmount: betAmount,
        remainingBalance: user.balance,
        gameId: gameState.gameId
      });
      
      console.log(`User ${userId} က ${betAmount} ထိုးလိုက်သည်။ လက်ကျန်: ${user.balance}`);
      
    } catch (error) {
      console.error('placeBet error:', error);
      socket.emit('error', { message: 'လောင်းကြေးထိုးရာတွင် အမှားရှိခဲ့ပါသည်။' });
    }
  });

  /**
   * ငွေထုတ်ခြင်း (Cashout) event
   * data: { userId }
   */
  socket.on('cashout', async (data) => {
    try {
      const { userId } = data;
      
      // ဂိမ်းကစားနေသည့်အချိန်တွင်သာ ငွေထုတ်ခွင့်ပြုမည်
      if (!gameState.isPlaying) {
        return socket.emit('error', { message: 'ငွေထုတ်ရန် အချိန်မဟုတ်ပါ။' });
      }
      
      // သုံးစွဲသူသည် လောင်းကြေးထိုးထားသူလား စစ်ဆေးခြင်း
      const betInfo = gameState.activeBets.get(userId);
      if (!betInfo) {
        return socket.emit('error', { message: 'သင်သည် ဤပွဲတွင် လောင်းကြေးမထိုးထားပါ။' });
      }
      
      // သုံးစွဲသူရှာဖွေခြင်း
      const user = await User.findOne({ userId });
      if (!user) {
        return socket.emit('error', { message: 'သုံးစွဲသူ မတွေ့ရှိပါ။' });
      }
      
      // ငွေထုတ်မည့် multiplier
      const cashoutMultiplier = gameState.currentMultiplier;
      const winAmount = betInfo.betAmount * cashoutMultiplier;
      
      // လက်ကျန်ငွေထည့်ပေးခြင်း
      user.balance += winAmount;
      
      // history ထဲသို့ အနိုင်ရမှတ်တမ်းထည့်ခြင်း
      user.history.push({
        gameId: gameState.gameId,
        betAmount: betInfo.betAmount,
        cashoutMultiplier: cashoutMultiplier,
        result: 'win'
      });
      
      await user.save();
      
      // activeBets မှ ဖယ်ရှားခြင်း
      gameState.activeBets.delete(userId);
      
      // သုံးစွဲသူအား အောင်မြင်ကြောင်း အကြောင်းကြားခြင်း
      socket.emit('cashoutSuccess', {
        multiplier: cashoutMultiplier,
        winAmount: winAmount,
        remainingBalance: user.balance
      });
      
      console.log(`User ${userId} က ${cashoutMultiplier}x ဖြင့် ငွေထုတ်လိုက်သည်။ ရရှိငွေ: ${winAmount}`);
      
    } catch (error) {
      console.error('cashout error:', error);
      socket.emit('error', { message: 'ငွေထုတ်ရာတွင် အမှားရှိခဲ့ပါသည်။' });
    }
  });

  /**
   * Client ချိတ်ဆက်မှုပြတ်သွားပါက သက်ဆိုင်ရာ bet ကိုဖယ်ရှားခြင်း
   */
  socket.on('disconnect', () => {
    console.log(`Client ချိတ်ဆက်မှုပြတ်သည်။ Socket ID: ${socket.id}`);
    
    // ဤ socket နှင့်ချိတ်ထားသော bet ကိုရှာပြီးဖယ်ရန်
    for (let [userId, betInfo] of gameState.activeBets.entries()) {
      if (betInfo.socketId === socket.id) {
        gameState.activeBets.delete(userId);
        console.log(`User ${userId} ၏ bet ကို disconnect ကြောင့်ဖယ်ရှားသည်။`);
        break;
      }
    }
  });
});

// ==================== Server စတင်ခြင်း ====================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server သည် PORT ${PORT} တွင် အလုပ်လုပ်နေပါသည်။`);
  
  // ဂိမ်းအစပြုခြင်း
  prepareNewGame();
  startWaitingCountdown();
});
