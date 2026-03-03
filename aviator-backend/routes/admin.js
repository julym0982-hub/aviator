const express = require('express');
const User = require('../models/User');
const router = express.Router();

/**
 * Admin မှ သုံးစွဲသူထံ coin ထည့်ပေးရန် API
 * POST /admin/add-coin
 * Body: { userId: "user123", amount: 100 }
 */
router.post('/add-coin', async (req, res) => {
  try {
    const { userId, amount } = req.body;

    // Input validation
    if (!userId || !amount) {
      return res.status(400).json({ 
        message: 'userId နှင့် amount နှစ်ခုလုံး လိုအပ်ပါသည်။' 
      });
    }

    if (amount <= 0) {
      return res.status(400).json({ 
        message: 'ငွေပမာဏသည် သုညထက် ကြီးရပါမည်။' 
      });
    }

    // သုံးစွဲသူရှာဖွေခြင်း
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ 
        message: 'သုံးစွဲသူ မတွေ့ရှိပါ။' 
      });
    }

    // လက်ကျန်ငွေထည့်ပေးခြင်း
    user.balance += amount;
    await user.save();

    res.json({ 
      message: 'ငွေထည့်ခြင်း အောင်မြင်ပါသည်။', 
      balance: user.balance 
    });
  } catch (error) {
    console.error('Admin add coin error:', error);
    res.status(500).json({ 
      message: 'ဆာဗာချို့ယွင်းမှု ဖြစ်ပွားပါသည်။' 
    });
  }
});

module.exports = router;
