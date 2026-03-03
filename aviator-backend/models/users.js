const mongoose = require('mongoose');

// သုံးစွဲသူ၏ ဒေတာပုံစံသတ်မှတ်ခြင်း
const userSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    unique: true,    // ထပ်တူမရှိစေရန်
    index: true       // ရှာဖွေမှုမြန်ဆန်စေရန်
  },
  balance: { 
    type: Number, 
    default: 0,       // ကနဦးလက်ကျန် ၀
    min: 0            // အနုတ်မဖြစ်စေရ
  },
  history: [
    {
      gameId: String,           // ပွဲစဉ် ID
      betAmount: Number,        // ထိုးကြေး
      cashoutMultiplier: Number,// ထွက်ခဲ့သော multiplier
      result: {                 // ရလဒ် (win/loss)
        type: String,
        enum: ['win', 'loss']
      },
      date: { 
        type: Date, 
        default: Date.now       // ထိုးခဲ့သောနေ့စွဲ
      }
    }
  ]
});

module.exports = mongoose.model('User', userSchema);
