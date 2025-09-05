const jwt = require('jsonwebtoken');
const { dbHelpers } = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// التحقق من المصادقة
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'رمز المصادقة مطلوب'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // البحث عن المستخدم في قاعدة البيانات
    const user = await dbHelpers.get(
      'SELECT id, email, name, language_preference, subscription_type FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'المستخدم غير موجود'
      });
    }

    req.user = user;
    next();

  } catch (error) {
    console.error('خطأ في المصادقة:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'انتهت صلاحية رمز المصادقة'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'رمز المصادقة غير صحيح'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'خطأ في التحقق من المصادقة'
    });
  }
};

// التحقق من نوع الاشتراك
const requireSubscription = (requiredType = 'pro') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'المصادقة مطلوبة'
      });
    }

    if (req.user.subscription_type !== requiredType && req.user.subscription_type !== 'premium') {
      return res.status(403).json({
        success: false,
        message: 'يتطلب اشتراك مدفوع للوصول لهذه الميزة',
        required_subscription: requiredType,
        current_subscription: req.user.subscription_type
      });
    }

    next();
  };
};

// تتبع استخدام المستخدم (للنسخة المجانية)
const trackUsage = (actionType, limit = null) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next();
      }

      // إذا كان المستخدم لديه اشتراك مدفوع، تخطي التحقق
      if (req.user.subscription_type === 'pro' || req.user.subscription_type === 'premium') {
        return next();
      }

      // التحقق من الاستخدام الشهري للمستخدمين المجانيين
      if (limit) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const usageCount = await dbHelpers.get(`
          SELECT COUNT(*) as count 
          FROM usage_stats 
          WHERE user_id = ? AND action_type = ? AND created_at >= ?
        `, [req.user.id, actionType, startOfMonth.toISOString()]);

        if (usageCount.count >= limit) {
          return res.status(429).json({
            success: false,
            message: `تم تجاوز الحد المسموح (${limit}) لهذا الشهر. قم بالترقية للنسخة المدفوعة للاستخدام غير المحدود.`,
            usage: {
              current: usageCount.count,
              limit: limit,
              action: actionType
            }
          });
        }

        req.currentUsage = usageCount.count;
        req.usageLimit = limit;
      }

      next();

    } catch (error) {
      console.error('خطأ في تتبع الاستخدام:', error);
      next(); // متابعة حتى لو حدث خطأ في التتبع
    }
  };
};

// تسجيل الاستخدام في قاعدة البيانات
const logUsage = async (userId, actionType, details = null) => {
  try {
    await dbHelpers.run(
      'INSERT INTO usage_stats (user_id, action_type, details) VALUES (?, ?, ?)',
      [userId, actionType, details ? JSON.stringify(details) : null]
    );
  } catch (error) {
    console.error('خطأ في تسجيل الاستخدام:', error);
  }
};

// مصادقة اختيارية (للمستخدمين غير المسجلين)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await dbHelpers.get(
        'SELECT id, email, name, language_preference, subscription_type FROM users WHERE id = ?',
        [decoded.userId]
      );

      if (user) {
        req.user = user;
      }
    }

    next();

  } catch (error) {
    // في حالة المصادقة الاختيارية، نتجاهل الأخطاء ونتابع
    console.log('مصادقة اختيارية فشلت:', error.message);
    next();
  }
};

// حدود الاستخدام للحسابات المجانية
const FREE_LIMITS = {
  SUMMARY_MONTHLY: 10,
  TRANSLATION_MONTHLY: 15,
  DAILY_REQUESTS: 50
};

// التحقق من حد الاستخدام اليومي
const dailyRateLimit = async (req, res, next) => {
  try {
    const userIdentifier = req.user ? req.user.id : req.ip;
    
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const dailyUsage = await dbHelpers.get(`
      SELECT COUNT(*) as count 
      FROM usage_stats 
      WHERE ${req.user ? 'user_id' : 'details LIKE'} ${req.user ? '= ?' : "'%' || ? || '%'"} 
      AND created_at >= ?
    `, [userIdentifier, startOfDay.toISOString()]);

    if (dailyUsage.count >= FREE_LIMITS.DAILY_REQUESTS) {
      return res.status(429).json({
        success: false,
        message: 'تم تجاوز الحد اليومي للطلبات. حاول غداً أو قم بالتسجيل للحصول على حد أعلى.',
        resetTime: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000).toISOString()
      });
    }

    req.dailyUsage = dailyUsage.count;
    next();

  } catch (error) {
    console.error('خطأ في فحص الحد اليومي:', error);
    next(); // متابعة في حالة الخطأ
  }
};

module.exports = {
  authenticateToken,
  requireSubscription,
  trackUsage,
  logUsage,
  optionalAuth,
  dailyRateLimit,
  FREE_LIMITS
};