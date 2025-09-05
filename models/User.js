const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../database/db').User;
const auth = require('../middleware/auth');
const router = express.Router();

// GET /api/user/profile - الحصول على ملف المستخدم
router.get('/profile', auth, async (req, res) => {
  try {
    const user = req.user;
    
    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          subscriptionType: user.subscriptionType,
          monthlyUsage: user.monthlyUsage,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin,
          upgradeDate: user.upgradeDate || null
        }
      }
    });
  } catch (error) {
    console.error('خطأ في جلب الملف الشخصي:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ في الخادم'
    });
  }
});

// PUT /api/user/profile - تحديث ملف المستخدم
router.put('/profile', auth, async (req, res) => {
  try {
    const { username, email } = req.body;
    const user = req.user;

    // التحقق من البيانات
    if (!username || !email) {
      return res.status(400).json({
        success: false,
        error: 'اسم المستخدم والبريد الإلكتروني مطلوبان'
      });
    }

    // التحقق من صحة البريد الإلكتروني
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'البريد الإلكتروني غير صحيح'
      });
    }

    // التحقق من عدم وجود اسم المستخدم أو البريد مسبقاً (عدا الحساب الحالي)
    const existingUser = await User.findOne({
      $and: [
        { _id: { $ne: user._id } },
        { $or: [{ email }, { username }] }
      ]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: existingUser.email === email ? 
          'البريد الإلكتروني مستخدم بالفعل' : 
          'اسم المستخدم مستخدم بالفعل'
      });
    }

    // تحديث البيانات
    user.username = username;
    user.email = email;
    await user.save();

    res.json({
      success: true,
      message: 'تم تحديث الملف الشخصي بنجاح',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          subscriptionType: user.subscriptionType
        }
      }
    });

  } catch (error) {
    console.error('خطأ في تحديث الملف الشخصي:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ أثناء تحديث الملف الشخصي'
    });
  }
});

// PUT /api/user/password - تغيير كلمة المرور
router.put('/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = req.user;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'كلمة المرور الحالية والجديدة مطلوبتان'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'كلمة المرور الجديدة يجب أن تكون أطول من 6 أحرف'
      });
    }

    // التحقق من كلمة المرور الحالية
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'كلمة المرور الحالية غير صحيحة'
      });
    }

    // تشفير كلمة المرور الجديدة
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    user.password = hashedNewPassword;
    await user.save();

    res.json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح'
    });

  } catch (error) {
    console.error('خطأ في تغيير كلمة المرور:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ أثناء تغيير كلمة المرور'
    });
  }
});

// GET /api/user/usage - إحصائيات الاستخدام المفصلة
router.get('/usage', auth, async (req, res) => {
  try {
    const user = req.user;
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`;
    
    // تحديث الشهر الحالي إذا لزم الأمر
    if (user.monthlyUsage.month !== currentMonth) {
      user.monthlyUsage = {
        month: currentMonth,
        summariesCount: 0,
        translationsCount: 0
      };
      await user.save();
    }

    const limits = user.subscriptionType === 'free' ? {
      summaries: 10,
      translations: 10
    } : {
      summaries: -1, // غير محدود
      translations: -1 // غير محدود
    };

    const remaining = user.subscriptionType === 'free' ? {
      summaries: Math.max(0, limits.summaries - user.monthlyUsage.summariesCount),
      translations: Math.max(0, limits.translations - user.monthlyUsage.translationsCount)
    } : {
      summaries: -1,
      translations: -1
    };

    // حساب تاريخ إعادة التعيين (أول يوم من الشهر القادم)
    const resetDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

    res.json({
      success: true,
      data: {
        subscriptionType: user.subscriptionType,
        currentUsage: user.monthlyUsage,
        limits: limits,
        remaining: remaining,
        month: currentMonth,
        resetDate: resetDate,
        daysUntilReset: Math.ceil((resetDate - currentDate) / (1000 * 60 * 60 * 24))
      }
    });

  } catch (error) {
    console.error('خطأ في جلب إحصائيات الاستخدام:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ في جلب الإحصائيات'
    });
  }
});

// PUT /api/user/upgrade - ترقية الاشتراك
router.put('/upgrade', auth, async (req, res) => {
  try {
    const user = req.user;

    if (user.subscriptionType === 'premium') {
      return res.status(400).json({
        success: false,
        error: 'أنت مشترك بالفعل في الخطة المميزة'
      });
    }

    // ترقية إلى النسخة المميزة
    user.subscriptionType = 'premium';
    user.upgradeDate = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'تم ترقية اشتراكك بنجاح! 🎉',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          subscriptionType: user.subscriptionType,
          upgradeDate: user.upgradeDate
        }
      }
    });

  } catch (error) {
    console.error('خطأ في ترقية الاشتراك:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ أثناء ترقية الاشتراك'
    });
  }
});

// PUT /api/user/downgrade - إلغاء الاشتراك المميز (للاختبار فقط)
router.put('/downgrade', auth, async (req, res) => {
  try {
    const user = req.user;

    if (user.subscriptionType === 'free') {
      return res.status(400).json({
        success: false,
        error: 'حسابك مجاني بالفعل'
      });
    }

    // التراجع إلى النسخة المجانية
    user.subscriptionType = 'free';
    user.downgradeDate = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'تم تحويل حسابك إلى النسخة المجانية',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          subscriptionType: user.subscriptionType,
          downgradeDate: user.downgradeDate
        }
      }
    });

  } catch (error) {
    console.error('خطأ في إلغاء الاشتراك:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ أثناء إلغاء الاشتراك'
    });
  }
});

// DELETE /api/user/account - حذف الحساب
router.delete('/account', auth, async (req, res) => {
  try {
    const { password } = req.body;
    const user = req.user;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'كلمة المرور مطلوبة لحذف الحساب'
      });
    }

    // التحقق من كلمة المرور
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'كلمة المرور غير صحيحة'
      });
    }

    // حذف الحساب
    await User.findByIdAndDelete(user._id);

    res.json({
      success: true,
      message: 'تم حذف حسابك بنجاح'
    });

  } catch (error) {
    console.error('خطأ في حذف الحساب:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ أثناء حذف الحساب'
    });
  }
});

// GET /api/user/stats - إحصائيات عامة للمستخدم
router.get('/stats', auth, async (req, res) => {
  try {
    const user = req.user;
    
    // حساب إجمالي الاستخدام منذ إنشاء الحساب
    const totalDays = Math.ceil((new Date() - user.createdAt) / (1000 * 60 * 60 * 24));
    
    res.json({
      success: true,
      data: {
        accountAge: {
          days: totalDays,
          months: Math.floor(totalDays / 30)
        },
        currentMonth: {
          summaries: user.monthlyUsage.summariesCount || 0,
          translations: user.monthlyUsage.translationsCount || 0
        },
        subscriptionInfo: {
          type: user.subscriptionType,
          isPremium: user.subscriptionType === 'premium',
          upgradeDate: user.upgradeDate || null
        },
        lastActivity: user.lastLogin || user.createdAt
      }
    });

  } catch (error) {
    console.error('خطأ في جلب الإحصائيات:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ في جلب الإحصائيات'
    });
  }
});

module.exports = router;