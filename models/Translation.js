const express = require('express');
const router = express.Router();
const TranslationService = require('../services/translationService');
const auth = require('../middleware/auth');

// GET /api/translation/languages - الحصول على قائمة اللغات المدعومة
router.get('/languages', (req, res) => {
  const supportedLanguages = [
    { code: 'ar', name: 'العربية', englishName: 'Arabic' },
    { code: 'en', name: 'الإنجليزية', englishName: 'English' },
    { code: 'fr', name: 'الفرنسية', englishName: 'French' }
  ];

  res.json({
    success: true,
    data: supportedLanguages
  });
});

// POST /api/translation/translate - ترجمة النص
router.post('/translate', auth, async (req, res) => {
  try {
    const { text, sourceLanguage = 'auto', targetLanguage } = req.body;
    
    if (!text || !targetLanguage) {
      return res.status(400).json({
        success: false,
        error: 'النص ولغة الهدف مطلوبان'
      });
    }

    if (text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'النص لا يمكن أن يكون فارغاً'
      });
    }

    const supportedLanguages = ['ar', 'en', 'fr'];
    if (!supportedLanguages.includes(targetLanguage)) {
      return res.status(400).json({
        success: false,
        error: 'اللغة المحددة غير مدعومة. اللغات المدعومة: ar, en, fr'
      });
    }

    // التحقق من حدود الاستخدام
    const user = req.user;
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`;
    
    if (user.subscriptionType === 'free') {
      if (user.monthlyUsage.month !== currentMonth) {
        // إعادة تعيين الاستخدام الشهري
        user.monthlyUsage = {
          month: currentMonth,
          summariesCount: user.monthlyUsage.summariesCount || 0,
          translationsCount: 0
        };
      }
      
      if (user.monthlyUsage.translationsCount >= 10) {
        return res.status(429).json({
          success: false,
          error: 'لقد تجاوزت الحد المسموح من الترجمات هذا الشهر (10 ترجمات)',
          upgradeRequired: true,
          remainingTranslations: 0
        });
      }
    }

    // كشف لغة النص إذا لم تكن محددة
    let detectedLanguage = sourceLanguage;
    if (sourceLanguage === 'auto') {
      detectedLanguage = TranslationService.detectLanguage(text);
    }

    // التحقق من أن اللغة المصدر مختلفة عن لغة الهدف
    if (detectedLanguage === targetLanguage) {
      return res.status(400).json({
        success: false,
        error: 'لغة النص ولغة الهدف متشابهتان'
      });
    }

    // ترجمة النص
    const translatedText = await TranslationService.translateText(text, targetLanguage, detectedLanguage);
    
    // تحديث إحصائيات الاستخدام
    if (user.subscriptionType === 'free') {
      user.monthlyUsage.translationsCount += 1;
      await user.save();
    }

    // الحصول على أسماء اللغات
    const getLanguageName = (code) => {
      const names = {
        'ar': 'العربية',
        'en': 'الإنجليزية', 
        'fr': 'الفرنسية'
      };
      return names[code] || code;
    };

    res.json({
      success: true,
      data: {
        originalText: text,
        translatedText: translatedText,
        sourceLanguage: detectedLanguage,
        targetLanguage: targetLanguage,
        sourceLanguageName: getLanguageName(detectedLanguage),
        targetLanguageName: getLanguageName(targetLanguage),
        characterCount: text.length,
        translatedCharacterCount: translatedText.length
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

// POST /api/translation/bulk-translate - ترجمة متعددة
router.post('/bulk-translate', auth, async (req, res) => {
  try {
    const { texts, targetLanguage, sourceLanguage = 'auto' } = req.body;
    
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'مصفوفة النصوص مطلوبة'
      });
    }

    if (!targetLanguage) {
      return res.status(400).json({
        success: false,
        error: 'لغة الهدف مطلوبة'
      });
    }

    if (texts.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'يمكن ترجمة 10 نصوص كحد أقصى في المرة الواحدة'
      });
    }

    const user = req.user;
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`;
    
    if (user.subscriptionType === 'free') {
      if (user.monthlyUsage.month !== currentMonth) {
        user.monthlyUsage = {
          month: currentMonth,
          summariesCount: user.monthlyUsage.summariesCount || 0,
          translationsCount: 0
        };
      }
      
      if (user.monthlyUsage.translationsCount + texts.length > 10) {
        return res.status(429).json({
          success: false,
          error: `ستتجاوز الحد المسموح من الترجمات. المتبقي: ${10 - user.monthlyUsage.translationsCount}`,
          upgradeRequired: true
        });
      }
    }

    // ترجمة جميع النصوص
    const translations = [];
    for (const text of texts) {
      if (text.trim().length > 0) {
        try {
          const translated = await TranslationService.translateText(text, targetLanguage, sourceLanguage);
          translations.push({
            original: text,
            translated: translated,
            success: true
          });
        } catch (error) {
          translations.push({
            original: text,
            translated: null,
            success: false,
            error: 'فشل في الترجمة'
          });
        }
      } else {
        translations.push({
          original: text,
          translated: '',
          success: true
        });
      }
    }

    // تحديث إحصائيات الاستخدام
    const successfulTranslations = translations.filter(t => t.success).length;
    if (user.subscriptionType === 'free') {
      user.monthlyUsage.translationsCount += successfulTranslations;
      await user.save();
    }

    res.json({
      success: true,
      data: {
        translations: translations,
        totalTranslated: successfulTranslations,
        targetLanguage: targetLanguage
      }
    });

  } catch (error) {
    console.error('خطأ في الترجمة المتعددة:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ أثناء الترجمة المتعددة'
    });
  }
});

// GET /api/translation/usage - إحصائيات الترجمة
router.get('/usage', auth, async (req, res) => {
  try {
    const user = req.user;
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`;
    
    // تحديث الشهر الحالي إذا لزم الأمر
    if (user.monthlyUsage.month !== currentMonth) {
      user.monthlyUsage = {
        month: currentMonth,
        summariesCount: user.monthlyUsage.summariesCount || 0,
        translationsCount: 0
      };
      await user.save();
    }

    const limits = user.subscriptionType === 'free' ? {
      translations: 10
    } : {
      translations: -1 // غير محدود
    };

    const remaining = user.subscriptionType === 'free' ? 
      Math.max(0, limits.translations - user.monthlyUsage.translationsCount) : -1;

    res.json({
      success: true,
      data: {
        subscriptionType: user.subscriptionType,
        translationsUsed: user.monthlyUsage.translationsCount,
        translationsLimit: limits.translations,
        translationsRemaining: remaining,
        month: currentMonth,
        resetDate: new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
      }
    });

  } catch (error) {
    console.error('خطأ في جلب إحصائيات الترجمة:', error);
    res.status(500).json({
      success: false,
      error: 'حدث خطأ في جلب الإحصائيات'
    });
  }
});

module.exports = router;