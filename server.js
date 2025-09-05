const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const path = require('path');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// استيراد المسارات
const authRoutes = require('./routes/auth');
const summaryRoutes = require('./routes/summary');
const translationRoutes = require('./routes/translation');
const userRoutes = require('./routes/user');

// إنشاء التطبيق
const app = express();
const PORT = process.env.PORT || 5000;

// إعدادات الأمان
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));

// إعدادات CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : 'http://localhost:3000',
  credentials: true
}));

// محدد المعدل
const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'middleware',
  points: 100, // عدد الطلبات
  duration: 60, // في الثانية
});

app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    res.status(429).json({
      success: false,
      message: 'تم تجاوز الحد المسموح من الطلبات. حاول مرة أخرى بعد دقيقة.'
    });
  }
});

// المتوسطات
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// خدمة الملفات الثابتة
app.use(express.static(path.join(__dirname, 'client/build')));

// المسارات
app.use('/api/auth', authRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/translation', translationRoutes);
app.use('/api/user', userRoutes);

// مسار الصحة
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'الخادم يعمل بشكل طبيعي',
    timestamp: new Date().toISOString()
  });
});

// التعامل مع React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// معالج الأخطاء العام
app.use((error, req, res, next) => {
  console.error('خطأ في الخادم:', error);
  res.status(500).json({
    success: false,
    message: 'حدث خطأ داخلي في الخادم',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// بدء تشغيل الخادم
app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
  console.log(`🌐 العنوان المحلي: http://localhost:${PORT}`);
});

module.exports = app;