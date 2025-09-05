const express = require('express');
const router = express.Router();
const SummaryService = require('../services/summaryService');
const TranslationService = require('../services/translationService');
const auth = require('../middleware/auth');

// POST /api/summary - تلخيص النص
router.post('/', auth, async (req, res) => {
  try {
    const { text, language = 'auto', maxLength = 200 } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'النص مطلوب للتلخيص' 
      });
    }

    if (text.length < 50) {
      return res.status(400).json({ 
        success: false, 
        error: 'النص قصير جداً للتلخيص (الحد الأدنى 50 حرف)' 
      });
    }

    // تحديد حدود المستخدم
    const user = req.user;
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`;
    
    if (user.subscriptionType === 'free') {
      if (user.monthlyUsage.month !== currentMonth) {
        // إعادة تعيين الاستخدام الشهري
        user.monthlyUsage = {
          month: currentMonth,
          summariesCount: 0,
          translationsCount: 0
        };
      }
      
      if (user.monthlyUsage.summariesCount >= 10) {
        return res.status(429).json({
          success: false,
          error: 'لقد تجاوزت الحد المسموح من التلخيصات هذا الشهر (10 تلخيصات)',
          upgradeRequired: true
        });
      }
    }

    // تلخيص النص
    const summary = await SummaryService.summarizeText(text, language, maxLength);
    
    // تحديث إحصائيات الاستخدام
    if (user.subscriptionType === 'free') {
      user.monthlyUsage.summariesCount += 1;
      await user.save();
    }

    res.json({
      success: true,
      data: {
        summary: summary,
        originalLength: text.length,
        summaryLength: summary.length,
        compressionRatio: Math.round((1 - summary.length / text.length) * 100),
        language: language
      }
    });

  } catch (error) {
    console.error('خطأ في التلخيص:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ أثناء تلخيص النص'
    });
  }
});

// POST /api/summary/translate - ترجمة الملخص
router.post('/translate', auth, async (req, res) => {
  try {
    const { text, targetLanguage } = req.body;
    
    if (!text || !targetLanguage) {
      return res.status(400).json({
        success: false,
        error: 'النص ولغة الهدف مطلوبان'
      });
    }

    const supportedLanguages = ['ar', 'en', 'fr'];
    if (!supportedLanguages.includes(targetLanguage)) {
      return res.status(400).json({
        success: false,
        error: 'اللغة غير مدعومة. اللغات المدعومة: ar, en, fr'
      });
    }

    // تحديد حدود المستخدم
    const user = req.user;
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`;
    
    if (user.subscriptionType === 'free') {
      if (user.monthlyUsage.month !== currentMonth) {
        user.monthlyUsage = {
          month: currentMonth,
          summariesCount: 0,
          translationsCount: 0
        };
      }
      
      if (user.monthlyUsage.translationsCount >= 10) {
        return res.status(429).json({
          success: false,
          error: 'لقد تجاوزت الحد المسموح من الترجمات هذا الشهر (10 ترجمات)',
          upgradeRequired: true
        });
      }
    }

    // ترجمة النص
    const translation = await TranslationService.translateText(text, targetLanguage);
    
    // تحديث إحصائيات الاستخدام
    if (user.subscriptionType === 'free') {
      user.monthlyUsage.translationsCount += 1;
      await user.save();
    }

    res.json({
      success: true,
      data: {
        originalText: text,
        translatedText: translation,
        targetLanguage: targetLanguage
      }
    });

  } catch (error) {
    console.error('خطأ في الترجمة:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ أثناء ترجمة النص'
    });
  }
});

// GET /api/summary/usage - الحصول على إحصائيات الاستخدام
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

    res.json({
      success: true,
      data: {
        subscriptionType: user.subscriptionType,
        currentUsage: user.monthlyUsage,
        limits: limits,
        month: currentMonth
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

module.exports = router;