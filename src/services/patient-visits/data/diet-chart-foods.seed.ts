/**
 * System food master for the diet-chart picker (clinicId NULL rows).
 * @module PatientVisits
 *
 * Inserted lazily (idempotently) by VisitDietChartService the first time a
 * clinic searches the master. Keys are stable lowercase slugs and must never
 * be renamed once shipped: charts snapshot labels, but clinic-specific
 * overrides and future re-seeds are matched on `key`.
 */

export const DIET_CHART_FOOD_GROUPS = [
  'grains',
  'pulses',
  'vegetables',
  'fruits',
  'dairy',
  'spices',
  'oils-fats',
  'nuts-seeds',
  'beverages',
  'sweets',
  'non-veg',
  'processed',
  'cooked-dishes',
] as const;

export type DietChartFoodGroup = (typeof DIET_CHART_FOOD_GROUPS)[number];

export interface DietChartFoodSeed {
  key: string;
  group: DietChartFoodGroup;
  nameEn: string;
  nameGu: string;
  nameHi: string;
  nameMr: string;
}

const seed = (
  key: string,
  group: DietChartFoodGroup,
  nameEn: string,
  nameGu: string,
  nameHi: string,
  nameMr: string
): DietChartFoodSeed => ({ key, group, nameEn, nameGu, nameHi, nameMr });

export const DIET_CHART_FOOD_SEED: readonly DietChartFoodSeed[] = [
  // ---- Grains -------------------------------------------------------------
  seed('rice', 'grains', 'Rice', 'ચોખા', 'चावल', 'तांदूळ'),
  seed('old-rice', 'grains', 'Old rice (purana shali)', 'જૂના ચોખા', 'पुराना चावल', 'जुने तांदूळ'),
  seed('wheat', 'grains', 'Wheat', 'ઘઉં', 'गेहूं', 'गहू'),
  seed('jowar', 'grains', 'Jowar (sorghum)', 'જુવાર', 'ज्वार', 'ज्वारी'),
  seed('bajra', 'grains', 'Bajra (pearl millet)', 'બાજરી', 'बाजरा', 'बाजरी'),
  seed('ragi', 'grains', 'Ragi (finger millet)', 'રાગી (નાચણી)', 'रागी (नाचनी)', 'नाचणी'),
  seed('barley', 'grains', 'Barley (yava)', 'જવ', 'जौ', 'जव (सातू)'),
  seed('oats', 'grains', 'Oats', 'ઓટ્સ', 'ओट्स', 'ओट्स'),
  seed('maize', 'grains', 'Maize (corn)', 'મકાઈ', 'मक्का', 'मका'),
  seed('semolina', 'grains', 'Semolina (rava / sooji)', 'રવો', 'सूजी (रवा)', 'रवा'),
  seed('puffed-rice', 'grains', 'Puffed rice (murmura)', 'મમરા', 'मुरमुरा', 'कुरमुरे'),
  seed('maida', 'grains', 'Refined flour (maida)', 'મેંદો', 'मैदा', 'मैदा'),

  // ---- Pulses -------------------------------------------------------------
  seed('moong-dal', 'pulses', 'Moong dal', 'મગની દાળ', 'मूंग दाल', 'मुगाची डाळ'),
  seed('whole-moong', 'pulses', 'Whole green gram (moong)', 'આખા મગ', 'साबुत मूंग', 'मूग'),
  seed('toor-dal', 'pulses', 'Toor dal (arhar)', 'તુવેર દાળ', 'अरहर (तूर) दाल', 'तूर डाळ'),
  seed('masoor-dal', 'pulses', 'Masoor dal (red lentil)', 'મસૂર દાળ', 'मसूर दाल', 'मसूर डाळ'),
  seed('chana-dal', 'pulses', 'Chana dal', 'ચણાની દાળ', 'चना दाल', 'हरभरा डाळ'),
  seed('urad-dal', 'pulses', 'Urad dal (black gram)', 'અડદની દાળ', 'उड़द दाल', 'उडीद डाळ'),
  seed('chickpeas', 'pulses', 'Chickpeas (kabuli chana)', 'કાબુલી ચણા', 'काबुली चना', 'काबुली चणे'),
  seed('black-chana', 'pulses', 'Black chana (kala chana)', 'કાળા ચણા', 'काला चना', 'काळे हरभरे'),
  seed('rajma', 'pulses', 'Kidney beans (rajma)', 'રાજમા', 'राजमा', 'राजमा'),
  seed('horse-gram', 'pulses', 'Horse gram (kulthi)', 'કળથી', 'कुलथी', 'कुळीथ (हुलगे)'),
  seed('black-eyed-peas', 'pulses', 'Black-eyed peas (chawli / lobia)', 'ચોળા', 'लोबिया', 'चवळी'),
  seed('moth-beans', 'pulses', 'Moth beans (matki)', 'મઠ', 'मोठ', 'मटकी'),
  seed('soybean', 'pulses', 'Soybean', 'સોયાબીન', 'सोयाबीन', 'सोयाबीन'),
  seed('green-peas', 'pulses', 'Green peas', 'વટાણા', 'हरी मटर', 'मटार'),
  seed('sprouts', 'pulses', 'Sprouts', 'ફણગાવેલા કઠોળ', 'अंकुरित अनाज', 'मोड आलेली कडधान्ये'),

  // ---- Vegetables ---------------------------------------------------------
  seed('bottle-gourd', 'vegetables', 'Bottle gourd (lauki / dudhi)', 'દૂધી', 'लौकी', 'दुधी भोपळा'),
  seed('ridge-gourd', 'vegetables', 'Ridge gourd (turai)', 'તુરિયા', 'तोरई', 'दोडका'),
  seed('bitter-gourd', 'vegetables', 'Bitter gourd (karela)', 'કારેલા', 'करेला', 'कारले'),
  seed('pumpkin', 'vegetables', 'Pumpkin (kaddu)', 'કોળું', 'कद्दू', 'लाल भोपळा'),
  seed(
    'ash-gourd',
    'vegetables',
    'Ash gourd (petha / kushmanda)',
    'ભૂરું કોળું',
    'पेठा (सफेद कद्दू)',
    'कोहळा'
  ),
  seed('pointed-gourd', 'vegetables', 'Pointed gourd (parwal)', 'પરવળ', 'परवल', 'परवर'),
  seed('ivy-gourd', 'vegetables', 'Ivy gourd (tindora / tondli)', 'ટીંડોળા', 'कुंदरू', 'तोंडली'),
  seed('spinach', 'vegetables', 'Spinach (palak)', 'પાલક', 'पालक', 'पालक'),
  seed('fenugreek-leaves', 'vegetables', 'Fenugreek leaves (methi)', 'મેથીની ભાજી', 'मेथी', 'मेथी'),
  seed(
    'amaranth-leaves',
    'vegetables',
    'Amaranth leaves (chaulai)',
    'તાંદળજો',
    'चौलाई',
    'तांदुळजा'
  ),
  seed('coriander-leaves', 'vegetables', 'Coriander leaves', 'કોથમીર', 'हरा धनिया', 'कोथिंबीर'),
  seed('curry-leaves', 'vegetables', 'Curry leaves', 'મીઠો લીમડો', 'करी पत्ता', 'कढीपत्ता'),
  seed('drumstick', 'vegetables', 'Drumstick (moringa)', 'સરગવો', 'सहजन', 'शेवगा'),
  seed('okra', 'vegetables', 'Okra (bhindi)', 'ભીંડા', 'भिंडी', 'भेंडी'),
  seed('carrot', 'vegetables', 'Carrot', 'ગાજર', 'गाजर', 'गाजर'),
  seed('beetroot', 'vegetables', 'Beetroot', 'બીટ', 'चुकंदर', 'बीट'),
  seed('radish', 'vegetables', 'Radish', 'મૂળા', 'मूली', 'मुळा'),
  seed('cucumber', 'vegetables', 'Cucumber', 'કાકડી', 'खीरा', 'काकडी'),
  seed('tomato', 'vegetables', 'Tomato', 'ટામેટાં', 'टमाटर', 'टोमॅटो'),
  seed('potato', 'vegetables', 'Potato', 'બટાકા', 'आलू', 'बटाटा'),
  seed('sweet-potato', 'vegetables', 'Sweet potato', 'શક્કરિયાં', 'शकरकंद', 'रताळे'),
  seed('onion', 'vegetables', 'Onion', 'ડુંગળી', 'प्याज', 'कांदा'),
  seed('garlic', 'vegetables', 'Garlic', 'લસણ', 'लहसुन', 'लसूण'),
  seed('ginger', 'vegetables', 'Ginger (fresh)', 'આદુ', 'अदरक', 'आले'),
  seed('brinjal', 'vegetables', 'Brinjal (eggplant)', 'રીંગણ', 'बैंगन', 'वांगी'),
  seed('cabbage', 'vegetables', 'Cabbage', 'કોબીજ', 'पत्ता गोभी', 'कोबी'),
  seed('cauliflower', 'vegetables', 'Cauliflower', 'ફ્લાવર', 'फूल गोभी', 'फ्लॉवर'),
  seed('capsicum', 'vegetables', 'Capsicum', 'શિમલા મરચું', 'शिमला मिर्च', 'ढोबळी मिरची'),
  seed('green-chilli', 'vegetables', 'Green chilli', 'લીલાં મરચાં', 'हरी मिर्च', 'हिरवी मिरची'),
  seed('cluster-beans', 'vegetables', 'Cluster beans (guar)', 'ગુવાર', 'ग्वार फली', 'गवार'),
  seed('french-beans', 'vegetables', 'French beans', 'ફણસી', 'फ्रेंच बीन्स', 'फरसबी'),
  seed('raw-banana', 'vegetables', 'Raw banana', 'કાચાં કેળાં', 'कच्चा केला', 'कच्ची केळी'),
  seed(
    'elephant-foot-yam',
    'vegetables',
    'Elephant foot yam (suran)',
    'સૂરણ',
    'सूरन (जिमीकंद)',
    'सुरण'
  ),
  seed('colocasia', 'vegetables', 'Colocasia (arbi)', 'અળવી', 'अरबी', 'अळू'),
  seed('mushroom', 'vegetables', 'Mushroom', 'મશરૂમ', 'मशरूम', 'मशरूम'),

  // ---- Fruits -------------------------------------------------------------
  seed('banana', 'fruits', 'Banana', 'કેળાં', 'केला', 'केळी'),
  seed('apple', 'fruits', 'Apple', 'સફરજન', 'सेब', 'सफरचंद'),
  seed('pomegranate', 'fruits', 'Pomegranate', 'દાડમ', 'अनार', 'डाळिंब'),
  seed('papaya', 'fruits', 'Papaya', 'પપૈયું', 'पपीता', 'पपई'),
  seed('mango', 'fruits', 'Mango', 'કેરી', 'आम', 'आंबा'),
  seed('guava', 'fruits', 'Guava', 'જામફળ', 'अमरूद', 'पेरू'),
  seed('orange', 'fruits', 'Orange', 'સંતરું', 'संतरा', 'संत्रे'),
  seed('sweet-lime', 'fruits', 'Sweet lime (mosambi)', 'મોસંબી', 'मौसमी', 'मोसंबी'),
  seed('lemon', 'fruits', 'Lemon', 'લીંબુ', 'नींबू', 'लिंबू'),
  seed('grapes', 'fruits', 'Grapes', 'દ્રાક્ષ', 'अंगूर', 'द्राक्षे'),
  seed('watermelon', 'fruits', 'Watermelon', 'તરબૂચ', 'तरबूज', 'कलिंगड'),
  seed('muskmelon', 'fruits', 'Muskmelon', 'શક્કરટેટી', 'खरबूजा', 'खरबूज'),
  seed('amla', 'fruits', 'Amla (Indian gooseberry)', 'આમળાં', 'आंवला', 'आवळा'),
  seed('dates', 'fruits', 'Dates', 'ખજૂર', 'खजूर', 'खजूर'),
  seed('figs', 'fruits', 'Figs (anjeer)', 'અંજીર', 'अंजीर', 'अंजीर'),
  seed('raisins', 'fruits', 'Raisins', 'કિસમિસ', 'किशमिश', 'मनुका'),
  seed('coconut', 'fruits', 'Coconut', 'નાળિયેર', 'नारियल', 'नारळ'),
  seed('jamun', 'fruits', 'Jamun (black plum)', 'જાંબુ', 'जामुन', 'जांभूळ'),
  seed('pineapple', 'fruits', 'Pineapple', 'અનાનસ', 'अनानास', 'अननस'),
  seed('custard-apple', 'fruits', 'Custard apple (sitaphal)', 'સીતાફળ', 'सीताफल', 'सीताफळ'),
  seed('chikoo', 'fruits', 'Chikoo (sapota)', 'ચીકુ', 'चीकू', 'चिकू'),
  seed('sour-fruits', 'fruits', 'Sour / citrus fruits', 'ખાટાં ફળો', 'खट्टे फल', 'आंबट फळे'),

  // ---- Dairy --------------------------------------------------------------
  seed('cow-milk', 'dairy', 'Cow milk', 'ગાયનું દૂધ', 'गाय का दूध', 'गाईचे दूध'),
  seed('buffalo-milk', 'dairy', 'Buffalo milk', 'ભેંસનું દૂધ', 'भैंस का दूध', 'म्हशीचे दूध'),
  seed('curd', 'dairy', 'Curd (dahi)', 'દહીં', 'दही', 'दही'),
  seed('buttermilk', 'dairy', 'Buttermilk (chaas / takra)', 'છાશ', 'छाछ', 'ताक'),
  seed('cow-ghee', 'dairy', 'Cow ghee', 'ગાયનું ઘી', 'गाय का घी', 'गाईचे तूप'),
  seed('butter', 'dairy', 'Butter', 'માખણ', 'मक्खन', 'लोणी'),
  seed('paneer', 'dairy', 'Paneer', 'પનીર', 'पनीर', 'पनीर'),
  seed('cheese', 'dairy', 'Cheese', 'ચીઝ', 'चीज़', 'चीज'),
  seed('curd-at-night', 'dairy', 'Curd at night', 'રાત્રે દહીં', 'रात में दही', 'रात्री दही'),

  // ---- Spices -------------------------------------------------------------
  seed('turmeric', 'spices', 'Turmeric', 'હળદર', 'हल्दी', 'हळद'),
  seed('cumin', 'spices', 'Cumin (jeera)', 'જીરું', 'जीरा', 'जिरे'),
  seed('coriander-seeds', 'spices', 'Coriander seeds', 'ધાણા', 'साबुत धनिया', 'धणे'),
  seed(
    'fenugreek-seeds',
    'spices',
    'Fenugreek seeds (methi dana)',
    'મેથીના દાણા',
    'मेथी दाना',
    'मेथी दाणे'
  ),
  seed('black-pepper', 'spices', 'Black pepper', 'કાળા મરી', 'काली मिर्च', 'काळी मिरी'),
  seed('asafoetida', 'spices', 'Asafoetida (hing)', 'હિંગ', 'हींग', 'हिंग'),
  seed('carom-seeds', 'spices', 'Carom seeds (ajwain)', 'અજમો', 'अजवाइन', 'ओवा'),
  seed('cinnamon', 'spices', 'Cinnamon', 'તજ', 'दालचीनी', 'दालचिनी'),
  seed('cardamom', 'spices', 'Cardamom', 'એલચી', 'इलायची', 'वेलची'),
  seed('clove', 'spices', 'Clove', 'લવિંગ', 'लौंग', 'लवंग'),
  seed('dry-ginger', 'spices', 'Dry ginger (sonth)', 'સૂંઠ', 'सोंठ', 'सुंठ'),
  seed('red-chilli', 'spices', 'Red chilli', 'લાલ મરચું', 'लाल मिर्च', 'लाल तिखट'),
  seed('rock-salt', 'spices', 'Rock salt (sendha namak)', 'સિંધવ મીઠું', 'सेंधा नमक', 'सैंधव मीठ'),
  seed('salt', 'spices', 'Salt (excess)', 'મીઠું (વધુ)', 'नमक (अधिक)', 'मीठ (जास्त)'),
  seed('tamarind', 'spices', 'Tamarind', 'આમલી', 'इमली', 'चिंच'),
  seed('mustard-seeds', 'spices', 'Mustard seeds', 'રાઈ', 'राई', 'मोहरी'),

  // ---- Oils & fats --------------------------------------------------------
  seed('groundnut-oil', 'oils-fats', 'Groundnut oil', 'સીંગતેલ', 'मूंगफली का तेल', 'शेंगदाणा तेल'),
  seed('sesame-oil', 'oils-fats', 'Sesame oil (til)', 'તલનું તેલ', 'तिल का तेल', 'तिळाचे तेल'),
  seed('coconut-oil', 'oils-fats', 'Coconut oil', 'નાળિયેર તેલ', 'नारियल तेल', 'खोबरेल तेल'),
  seed('mustard-oil', 'oils-fats', 'Mustard oil', 'સરસવનું તેલ', 'सरसों का तेल', 'मोहरीचे तेल'),
  seed('refined-oil', 'oils-fats', 'Refined oil', 'રિફાઇન્ડ તેલ', 'रिफाइंड तेल', 'रिफाइंड तेल'),
  seed(
    'vanaspati',
    'oils-fats',
    'Vanaspati (dalda)',
    'વનસ્પતિ ઘી',
    'वनस्पति घी (डालडा)',
    'वनस्पती तूप (डालडा)'
  ),

  // ---- Nuts & seeds -------------------------------------------------------
  seed('almonds', 'nuts-seeds', 'Almonds', 'બદામ', 'बादाम', 'बदाम'),
  seed('walnuts', 'nuts-seeds', 'Walnuts', 'અખરોટ', 'अखरोट', 'अक्रोड'),
  seed('cashews', 'nuts-seeds', 'Cashews', 'કાજુ', 'काजू', 'काजू'),
  seed('peanuts', 'nuts-seeds', 'Peanuts', 'સીંગદાણા', 'मूंगफली', 'शेंगदाणे'),
  seed('sesame-seeds', 'nuts-seeds', 'Sesame seeds (til)', 'તલ', 'तिल', 'तीळ'),
  seed('flax-seeds', 'nuts-seeds', 'Flax seeds (alsi)', 'અળસી', 'अलसी', 'जवस'),
  seed(
    'pumpkin-seeds',
    'nuts-seeds',
    'Pumpkin seeds',
    'કોળાનાં બીજ',
    'कद्दू के बीज',
    'भोपळ्याच्या बिया'
  ),
  seed('pistachios', 'nuts-seeds', 'Pistachios', 'પિસ્તા', 'पिस्ता', 'पिस्ता'),

  // ---- Beverages ----------------------------------------------------------
  seed('warm-water', 'beverages', 'Warm water', 'હૂંફાળું પાણી', 'गुनगुना पानी', 'कोमट पाणी'),
  seed(
    'cold-water',
    'beverages',
    'Cold / iced water',
    'ઠંડું (બરફવાળું) પાણી',
    'ठंडा (बर्फ वाला) पानी',
    'थंड (बर्फाचे) पाणी'
  ),
  seed('tea', 'beverages', 'Tea', 'ચા', 'चाय', 'चहा'),
  seed('coffee', 'beverages', 'Coffee', 'કૉફી', 'कॉफ़ी', 'कॉफी'),
  seed('green-tea', 'beverages', 'Green tea', 'ગ્રીન ટી', 'ग्रीन टी', 'ग्रीन टी'),
  seed('herbal-decoction', 'beverages', 'Herbal decoction (kadha)', 'ઉકાળો', 'काढ़ा', 'काढा'),
  seed(
    'cumin-water',
    'beverages',
    'Cumin water (jeera water)',
    'જીરાનું પાણી',
    'जीरा पानी',
    'जिऱ्याचे पाणी'
  ),
  seed('lemon-water', 'beverages', 'Lemon water', 'લીંબુ પાણી', 'नींबू पानी', 'लिंबू पाणी'),
  seed('coconut-water', 'beverages', 'Coconut water', 'નાળિયેર પાણી', 'नारियल पानी', 'नारळ पाणी'),
  seed(
    'soft-drinks',
    'beverages',
    'Carbonated soft drinks',
    'ઠંડા પીણાં (સોડા)',
    'कोल्ड ड्रिंक (सोडा)',
    'शीतपेये (सोडा)'
  ),
  seed(
    'packaged-juice',
    'beverages',
    'Packaged fruit juice',
    'પેકેજ્ડ જ્યુસ',
    'पैकेट वाला जूस',
    'पॅकबंद ज्यूस'
  ),
  seed('alcohol', 'beverages', 'Alcohol', 'દારૂ', 'शराब', 'मद्य (दारू)'),

  // ---- Sweets -------------------------------------------------------------
  seed('jaggery', 'sweets', 'Jaggery (gud)', 'ગોળ', 'गुड़', 'गूळ'),
  seed('sugar', 'sweets', 'Sugar', 'ખાંડ', 'चीनी', 'साखर'),
  seed('honey', 'sweets', 'Honey', 'મધ', 'शहद', 'मध'),
  seed('sweets', 'sweets', 'Sweets (mithai)', 'મીઠાઈ', 'मिठाई', 'मिठाई'),
  seed('chocolate', 'sweets', 'Chocolate', 'ચોકલેટ', 'चॉकलेट', 'चॉकलेट'),
  seed('ice-cream', 'sweets', 'Ice cream', 'આઇસક્રીમ', 'आइसक्रीम', 'आइस्क्रीम'),

  // ---- Non-veg ------------------------------------------------------------
  seed('eggs', 'non-veg', 'Eggs', 'ઈંડાં', 'अंडे', 'अंडी'),
  seed('chicken', 'non-veg', 'Chicken', 'ચિકન', 'चिकन', 'चिकन'),
  seed('mutton', 'non-veg', 'Mutton', 'મટન', 'मटन', 'मटण'),
  seed('fish', 'non-veg', 'Fish', 'માછલી', 'मछली', 'मासे'),
  seed('prawns', 'non-veg', 'Prawns', 'ઝીંગા', 'झींगा', 'कोळंबी'),

  // ---- Processed / avoid --------------------------------------------------
  seed('fried-foods', 'processed', 'Fried foods', 'તળેલો ખોરાક', 'तला हुआ खाना', 'तळलेले पदार्थ'),
  seed(
    'bakery-items',
    'processed',
    'Bakery items (biscuits, cakes)',
    'બેકરી વસ્તુઓ (બિસ્કિટ, કેક)',
    'बेकरी उत्पाद (बिस्कुट, केक)',
    'बेकरी पदार्थ (बिस्किट, केक)'
  ),
  seed('bread', 'processed', 'Bread', 'બ્રેડ', 'ब्रेड', 'ब्रेड (पाव)'),
  seed(
    'packaged-snacks',
    'processed',
    'Packaged snacks (chips)',
    'પેકેટ નાસ્તા (ચિપ્સ)',
    'पैकेट वाले स्नैक्स (चिप्स)',
    'पॅकबंद स्नॅक्स (चिप्स)'
  ),
  seed(
    'instant-noodles',
    'processed',
    'Instant noodles',
    'ઇન્સ્ટન્ટ નૂડલ્સ',
    'इंस्टेंट नूडल्स',
    'इन्स्टंट नूडल्स'
  ),
  seed(
    'fast-food',
    'processed',
    'Fast food (pizza, burger)',
    'ફાસ્ટ ફૂડ (પિઝા, બર્ગર)',
    'फास्ट फूड (पिज़्ज़ा, बर्गर)',
    'फास्ट फूड (पिझ्झा, बर्गर)'
  ),
  seed('pickles', 'processed', 'Pickles', 'અથાણું', 'अचार', 'लोणचे'),
  seed('papad', 'processed', 'Papad', 'પાપડ', 'पापड़', 'पापड'),
  seed('stale-food', 'processed', 'Stale / leftover food', 'વાસી ખોરાક', 'बासी खाना', 'शिळे अन्न'),
  seed(
    'fermented-foods',
    'processed',
    'Fermented foods',
    'આથો આવેલો ખોરાક',
    'खमीर वाला खाना',
    'आंबवलेले पदार्थ'
  ),
  seed(
    'spicy-food',
    'processed',
    'Very spicy food',
    'ખૂબ તીખો ખોરાક',
    'बहुत मसालेदार खाना',
    'खूप तिखट अन्न'
  ),
  seed('tobacco', 'processed', 'Tobacco', 'તમાકુ', 'तंबाकू', 'तंबाखू'),

  // ---- Cooked dishes ------------------------------------------------------
  seed(
    'moong-khichdi',
    'cooked-dishes',
    'Moong dal khichdi',
    'મગની ખીચડી',
    'मूंग दाल खिचड़ी',
    'मुगाची खिचडी'
  ),
  seed('dal', 'cooked-dishes', 'Dal (lentil soup)', 'દાળ', 'दाल', 'वरण (डाळ)'),
  seed('roti', 'cooked-dishes', 'Roti / chapati', 'રોટલી', 'रोटी', 'पोळी (चपाती)'),
  seed(
    'bajra-rotla',
    'cooked-dishes',
    'Bajra rotla / bhakri',
    'બાજરીનો રોટલો',
    'बाजरे की रोटी',
    'बाजरीची भाकरी'
  ),
  seed(
    'jowar-bhakri',
    'cooked-dishes',
    'Jowar bhakri',
    'જુવારનો રોટલો',
    'ज्वार की रोटी',
    'ज्वारीची भाकरी'
  ),
  seed('idli', 'cooked-dishes', 'Idli', 'ઈડલી', 'इडली', 'इडली'),
  seed('dosa', 'cooked-dishes', 'Dosa', 'ઢોસા', 'डोसा', 'डोसा'),
  seed('upma', 'cooked-dishes', 'Upma', 'ઉપમા', 'उपमा', 'उपमा'),
  seed('poha', 'cooked-dishes', 'Poha', 'પૌંઆ', 'पोहा', 'पोहे'),
  seed('dalia', 'cooked-dishes', 'Broken wheat porridge (dalia)', 'દલિયા', 'दलिया', 'दलिया'),
  seed(
    'rice-gruel',
    'cooked-dishes',
    'Rice gruel (kanji / peya)',
    'ચોખાની કાંજી',
    'चावल की कांजी (पेया)',
    'तांदळाची पेज'
  ),
  seed(
    'vegetable-soup',
    'cooked-dishes',
    'Vegetable soup',
    'શાકભાજીનો સૂપ',
    'सब्ज़ियों का सूप',
    'भाज्यांचे सूप'
  ),
  seed(
    'steamed-vegetables',
    'cooked-dishes',
    'Steamed vegetables',
    'બાફેલાં શાકભાજી',
    'उबली हुई सब्ज़ियाँ',
    'वाफवलेल्या भाज्या'
  ),
  seed('salad', 'cooked-dishes', 'Salad (raw vegetables)', 'કચુંબર', 'सलाद', 'कोशिंबीर'),
  seed('curd-rice', 'cooked-dishes', 'Curd rice', 'દહીં-ભાત', 'दही चावल', 'दही-भात'),
  seed('paratha', 'cooked-dishes', 'Paratha', 'પરોઠા', 'पराठा', 'पराठा'),
  seed(
    'fried-snacks',
    'cooked-dishes',
    'Fried snacks (samosa, pakora)',
    'ભજિયાં-સમોસા',
    'समोसा-पकौड़े',
    'भजी-समोसा'
  ),
];
