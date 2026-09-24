export type PassengerLanguage = 'en' | 'yi' | 'he';

export const translations = {
  en: {
    // General
    nextStop: 'Next Stop',
    nowArriving: 'Now Arriving',
    eta: 'ETA',
    final: 'Final',
    miles: 'mi',
    minutes: 'min',
    remaining: 'Remaining',
    
    // Status
    gpsLive: 'GPS live',
    gpsOffline: 'GPS offline',
    gpsEstimated: 'GPS estimated',
    awaitingDeparture: 'Awaiting departure',
    
    // Map Progress
    liveGps: 'Live GPS',
    followingRoute: 'Following route',
    intermediateStops: 'intermediate stops',
    finalDestination: 'Final Destination',
    approaching: 'Approaching',
    
    // Next Stop View
    destinationAhead: 'Destination ahead',
    gatherBelongings: 'Please gather your personal belongings.',
    stopsAfterThis: 'stops after this',
    stopAfterThis: 'stop after this',
    finalDestinationIs: 'Final destination:',
    
    // Pairing
    enterPairingCode: 'Enter Pairing Code',
    pairingInstructions: 'Enter the four-digit code shown in the operator app.',
    pairingPlaceholder: '4-digit code',
    connecting: 'Connecting...',
    continue: 'Continue',
    coachLabel: 'Coach',
    leaveTrip: 'Leave trip',
    attention: 'Attention',
    announcementsLabel: 'Announcements',
    guideLabel: 'Guide',
    faresLabel: 'Fares',
    destinationsLabel: 'Destinations',
    amenitiesLabel: 'Amenities',
    safetyLabel: 'Safety',
    
    // Fullscreen
    enterFullScreen: 'Enter Full Screen',
    fullScreen: 'Full Screen',
    exitFullScreen: 'Exit Full Screen',
    whereWeGo: 'Where we go', destinationsTitle: 'Monsey Trails destinations', destinationsSubtitle: 'Regular service connecting Rockland County and New York City communities.',
    planTrip: 'Plan your trip', faresTitle: 'Fares & tickets', faresSubtitle: 'Current published fares and ticket rules. Ask the driver if you need help.',
    knowBeforeGo: 'Know before you go', guideTitle: 'Passenger guide', guideSubtitle: 'A quick guide to children’s travel, baggage, seating, and lost items.',
    hereToHelp: 'We’re here to help', contactTitle: 'Contact Monsey Trails', contactSubtitle: 'Customer service, dispatch, lost and found, and company headquarters.',
    officialWebsite: 'Official website information', reviewed: 'reviewed', informationOverdue: 'Information review is overdue. Please confirm current details with the driver.', loadingInfo: 'Loading reviewed passenger information…',
    amenities: 'Prevost H3-45 amenities', powerWithinReach: 'Power is within reach', chargeDescription: 'Charge your phone from the overhead USB ports or the power panel between the seats.',
    aboveSeat: 'Above your seat', betweenSeats: 'Between the seat backs', seatPower: 'Seat power', option: 'Option', overheadUsb: 'Overhead USB', outletPanel: 'Outlet + USB panel', portsBesideLamps: 'Overhead ports are beside the reading lamps. Seat outlets are centered between the seat backs.', unplugBeforeLeaving: 'Unplug devices before leaving.',
    safetyBriefing: 'Coach 9923 safety briefing', emergencyExits: 'Know your emergency exits', locateExit: 'Please take a moment to locate the nearest exit. It may be behind you.', exitLocations: 'Exit locations', locateMarkedExits: 'Locate marked exits before departure.', inEmergency: 'In any emergency: remain calm and follow the driver’s instructions.', sideWindows: 'Side windows', sideWindowsDetail: 'Lift the release bar at the sill. Push the bottom of the window outward.', roofHatch: 'Roof hatch', roofHatchDetail: 'Push up. Turn the knob ¼ turn toward “TO EXIT.” Push the knob, then push the hatch outward.', frontEntrance: 'Front entrance', frontEntranceDetail: 'Turn the marked interior unlatch air valve in the arrow direction, then push the door open.',
    weatherAlongRoute: 'Weather Along the Route', destinationWeather: 'Destination Weather', offlineWeather: 'Offline · last known weather', weatherDelayed: 'Weather update delayed', liveCoachLocation: 'Live at coach location', currentCoachLocation: 'Current coach location', feelsLike: 'Feels like', mph: 'mph',
    travelConditions: 'Travel Conditions', offlineConditions: 'Offline · last known conditions', conditionsDelayed: 'Conditions may be delayed', traffic: 'traffic', currentCorridor: 'Current corridor', estimatedArrival: 'Estimated arrival', estimatedDelay: 'Estimated delay', minutesRemaining: 'minutes remaining', updated: 'Updated',
    jewishToday: 'Jewish Today', updatedAutomatically: 'Updated automatically', lastSavedInfo: 'Last saved information', updating: 'Updating', candleLighting: 'Candle lighting today', shabbatEnds: 'Shabbat ends today',
    dailyZmanim: 'Daily Zmanim', monseyTimes: 'Monsey times · automatic', lastSavedTimes: 'Last saved times', timesUpdate: 'Times update automatically each day', noAnnouncements: 'No saved announcements', passengerInformation: 'Passenger Information',
    liveAt: 'Live at', trafficClear: 'clear', trafficModerate: 'moderate', trafficHeavy: 'heavy', pageOf: 'of',
    alotHaShachar: 'Alot HaShachar', earliestTallit: 'Earliest Tallit & Tefillin', sunrise: 'Sunrise', latestShemaMGA: 'Latest Shema · M.A.', latestShemaGRA: 'Latest Shema · G.R.A.', latestShacharit: 'Latest Shacharit', chatzot: 'Chatzot', minchaGedola: 'Mincha Gedola', plagHaMincha: 'Plag HaMincha', sunset: 'Sunset', nightfall: 'Nightfall',
    exitLabel: 'Exit', manualSource: 'Prevost H-Series Operator’s Manual · Section 7', dafDaily: 'Daily Daf', hebrewDateLabel: 'Hebrew date'
  },
  he: {
    nextStop: 'התחנה הבאה',
    nowArriving: 'מגיעים כעת',
    eta: 'זמן הגעה',
    final: 'סופי',
    miles: 'מיילים',
    minutes: 'דק׳',
    remaining: 'נותרו',
    
    gpsLive: 'GPS פעיל',
    gpsOffline: 'GPS מנותק',
    gpsEstimated: 'GPS משוער',
    awaitingDeparture: 'ממתין ליציאה',
    
    liveGps: 'GPS חי',
    followingRoute: 'במסלול',
    intermediateStops: 'תחנות ביניים',
    finalDestination: 'יעד סופי',
    approaching: 'מתקרבים',
    
    destinationAhead: 'היעד לפנינו',
    gatherBelongings: 'אנא קחו את חפציכם האישיים.',
    stopsAfterThis: 'תחנות אחרי זו',
    stopAfterThis: 'תחנה אחרי זו',
    finalDestinationIs: 'יעד סופי:',
    
    enterPairingCode: 'הזן קוד צימוד',
    pairingInstructions: 'הזן את הקוד בן 4 הספרות המופיע באפליקציית הנהג.',
    pairingPlaceholder: 'קוד בן 4 ספרות',
    connecting: 'מתחבר...',
    continue: 'המשך',
    coachLabel: 'אוטובוס',
    leaveTrip: 'עזיבת הנסיעה',
    attention: 'שימו לב',
    announcementsLabel: 'הודעות',
    guideLabel: 'מדריך',
    faresLabel: 'תעריפים',
    destinationsLabel: 'יעדים',
    amenitiesLabel: 'שירותים',
    safetyLabel: 'בטיחות',
    
    enterFullScreen: 'מסך מלא',
    fullScreen: 'מסך מלא',
    exitFullScreen: 'צא ממסך מלא',
    whereWeGo: 'לאן אנחנו נוסעים', destinationsTitle: 'יעדי מונסי טריילס', destinationsSubtitle: 'שירות קבוע המחבר בין מחוז רוקלנד לקהילות ניו יורק.',
    planTrip: 'תכננו את הנסיעה', faresTitle: 'תעריפים וכרטיסים', faresSubtitle: 'תעריפים וכללי כרטיסים עדכניים. שאלו את הנהג אם אתם זקוקים לעזרה.',
    knowBeforeGo: 'כדאי לדעת לפני הנסיעה', guideTitle: 'מדריך לנוסע', guideSubtitle: 'מדריך קצר לנסיעת ילדים, מטען, ישיבה ואבידות.',
    hereToHelp: 'אנחנו כאן כדי לעזור', contactTitle: 'צרו קשר עם מונסי טריילס', contactSubtitle: 'שירות לקוחות, שיגור, אבדות ומציאות ומטה החברה.',
    officialWebsite: 'מידע מהאתר הרשמי', reviewed: 'נבדק', informationOverdue: 'בדיקת המידע באיחור. נא לאשר את הפרטים העדכניים עם הנהג.', loadingInfo: 'טוען מידע לנוסעים שנבדק…',
    amenities: 'אביזרי Prevost H3-45', powerWithinReach: 'חשמל בהישג יד', chargeDescription: 'הטעינו את הטלפון משקעי ה-USB שמעל הראש או מלוח החשמל שבין המושבים.',
    aboveSeat: 'מעל המושב', betweenSeats: 'בין גב המושבים', seatPower: 'חשמל למושב', option: 'אפשרות', overheadUsb: 'USB עילי', outletPanel: 'שקע ולוח USB', portsBesideLamps: 'שקעי ה-USB העיליים נמצאים לצד מנורות הקריאה. השקעים נמצאים במרכז בין גב המושבים.', unplugBeforeLeaving: 'נתקו מכשירים לפני הירידה.',
    safetyBriefing: 'תדריך בטיחות באוטובוס 9923', emergencyExits: 'הכירו את יציאות החירום', locateExit: 'הקדישו רגע לאיתור היציאה הקרובה. ייתכן שהיא מאחוריכם.', exitLocations: 'מיקומי יציאות', locateMarkedExits: 'אתרו את היציאות המסומנות לפני היציאה לדרך.', inEmergency: 'בכל מקרה חירום: הישארו רגועים ופעלו לפי הוראות הנהג.', sideWindows: 'חלונות צד', sideWindowsDetail: 'הרימו את מוט השחרור באדן. דחפו את תחתית החלון החוצה.', roofHatch: 'פתח גג', roofHatchDetail: 'דחפו כלפי מעלה. סובבו את הכפתור רבע סיבוב לכיוון “TO EXIT”. דחפו את הכפתור ואז את הפתח החוצה.', frontEntrance: 'כניסה קדמית', frontEntranceDetail: 'סובבו את שסתום שחרור הדלת המסומן בכיוון החץ, ואז דחפו את הדלת לפתיחה.',
    weatherAlongRoute: 'מזג האוויר לאורך המסלול', destinationWeather: 'מזג האוויר ביעד', offlineWeather: 'לא מקוון · מזג אוויר אחרון', weatherDelayed: 'עדכון מזג האוויר מתעכב', liveCoachLocation: 'חי במיקום האוטובוס', currentCoachLocation: 'מיקום האוטובוס הנוכחי', feelsLike: 'מרגיש כמו', mph: 'מייל לשעה',
    travelConditions: 'תנאי הנסיעה', offlineConditions: 'לא מקוון · תנאים אחרונים', conditionsDelayed: 'ייתכן שהתנאים מתעכבים', traffic: 'תנועה', currentCorridor: 'המסלול הנוכחי', estimatedArrival: 'זמן הגעה משוער', estimatedDelay: 'עיכוב משוער', minutesRemaining: 'דקות נותרו', updated: 'עודכן',
    jewishToday: 'היום היהודי', updatedAutomatically: 'מתעדכן אוטומטית', lastSavedInfo: 'המידע האחרון שנשמר', updating: 'מתעדכן', candleLighting: 'הדלקת נרות היום', shabbatEnds: 'שבת מסתיימת היום',
    dailyZmanim: 'זמני היום', monseyTimes: 'זמני מונסי · אוטומטי', lastSavedTimes: 'הזמנים האחרונים שנשמרו', timesUpdate: 'הזמנים מתעדכנים אוטומטית מדי יום', noAnnouncements: 'אין הודעות שמורות', passengerInformation: 'מידע לנוסעים',
    liveAt: 'חי ב', trafficClear: 'זורם', trafficModerate: 'בינוני', trafficHeavy: 'כבד', pageOf: 'מתוך',
    alotHaShachar: 'עלות השחר', earliestTallit: 'משיכיר', sunrise: 'הנץ החמה', latestShemaMGA: 'סוף זמן שמע מג״א', latestShemaGRA: 'סוף זמן שמע גר״א', latestShacharit: 'סוף זמן תפילה', chatzot: 'חצות היום', minchaGedola: 'מנחה גדולה', plagHaMincha: 'פלג המנחה', sunset: 'שקיעה', nightfall: 'צאת הכוכבים',
    exitLabel: 'יציאה', manualSource: 'מדריך המפעיל Prevost H-Series · סעיף 7', dafDaily: 'דף יומי', hebrewDateLabel: 'התאריך העברי'
  },
  yi: {
    nextStop: 'קומענדיגע סטאפ',
    nowArriving: 'מיר קומען יעצט אן',
    eta: 'אנצוקומען',
    final: 'ענדגילטיג',
    miles: 'מייל',
    minutes: 'מינוט',
    remaining: 'געבליבן',
    
    gpsLive: 'GPS לייוו',
    gpsOffline: 'GPS אף-ליין',
    gpsEstimated: 'GPS געשאצט',
    awaitingDeparture: 'ווארטן צו פארן',
    
    liveGps: 'לייוו GPS',
    followingRoute: 'פארן אויפן רוט',
    intermediateStops: 'צווישן סטאפס',
    finalDestination: 'ענדגילטיגע דעסטינאציע',
    approaching: 'דערנענטערן זיך',
    
    destinationAhead: 'דעסטינאציע פאראויס',
    gatherBelongings: 'ביטע נעמט אייערע פערזענליכע חפצים.',
    stopsAfterThis: 'סטאפס נאך דעם',
    stopAfterThis: 'סטאפ נאך דעם',
    finalDestinationIs: 'ענדגילטיגע דעסטינאציע:',
    
    enterPairingCode: 'לייגט אריין די פעירינג קאד',
    pairingInstructions: 'לייגט אריין די 4-ציפערן קאד וואס שטייט אויף די דרייווער עפפ.',
    pairingPlaceholder: '4-ציפערן קאד',
    connecting: 'קאנעקטינג...',
    continue: 'גייט ווייטער',
    coachLabel: 'קאוטש',
    leaveTrip: 'פארלאזן די רייזע',
    attention: 'אכטונג',
    announcementsLabel: 'מעלדונגען',
    guideLabel: 'פירער',
    faresLabel: 'פרייזן',
    destinationsLabel: 'דעסטינאציעס',
    amenitiesLabel: 'איינריכטונגען',
    safetyLabel: 'זיכערהייט',
    
    enterFullScreen: 'עפנט אויף גאנצן סקרין',
    fullScreen: 'גאנצן סקרין',
    exitFullScreen: 'פארמאך גאנצן סקרין',
    whereWeGo: 'וואו מיר פארן', destinationsTitle: 'מונסי טרעילס דעסטינאציעס', destinationsSubtitle: 'רעגולערע סערוויס פארבינדט ראקלענד קאונטי און ניו יארק סיטי קאמיוניטיס.',
    planTrip: 'פלאנירט אייער רייזע', faresTitle: 'פרייזן און טיקעטס', faresSubtitle: 'אקטועלע פרייזן און טיקעט רעגלען. פרעגט דעם דרייווער פאר הילף.',
    knowBeforeGo: 'וויסט פארן פארן', guideTitle: 'פאסאזשירער פירער', guideSubtitle: 'א קורצער פירער צו קינדער רייזע, באגאזש, זיצן און פארלוירענע זאכן.',
    hereToHelp: 'מיר זענען דא צו העלפן', contactTitle: 'קאנטאקט מונסי טרעילס', contactSubtitle: 'קאסטומער סערוויס, דיספעטש, פארלוירענע און געפונענע זאכן, און הויפטקווארטיר.',
    officialWebsite: 'אינפארמאציע פון אפיציעלן וועבזייטל', reviewed: 'איבערגעקוקט', informationOverdue: 'די אינפארמאציע איבערקוקונג איז פארשפעטיקט. באשטעטיגט די אקטועלע דעטאלן מיטן דרייווער.', loadingInfo: 'לאדט איבערגעקוקטע פאסאזשירער אינפארמאציע…',
    amenities: 'Prevost H3-45 איינריכטונגען', powerWithinReach: 'קראפט איז אין דער נאנט', chargeDescription: 'טשארדזשט אייער טעלעפאן פון די USB פאסן אויבן אדער פון די קראפט פאנעל צווישן די זיצן.',
    aboveSeat: 'איבער אייער זיץ', betweenSeats: 'צווישן די זיץ-רוקן', seatPower: 'זיץ קראפט', option: 'אפציע', overheadUsb: 'אויבערשטער USB', outletPanel: 'אוטלעט און USB פאנעל', portsBesideLamps: 'די אויבערשטע פאסן זענען ביי די ליינען לאמפן. די אוטלעטס זענען אין צענטער צווישן די זיץ-רוקן.', unplugBeforeLeaving: 'אויסטשעקט מכשירים פארן ארויסגיין.',
    safetyBriefing: 'קאוטש 9923 זיכערהייט בריפינג', emergencyExits: 'קענט אייערע עמערדזשענסי ארויסגענג', locateExit: 'נעמט א מינוט צו געפינען דעם נאנטסטן ארויסגאנג. עס קען זיין הינטער אייך.', exitLocations: 'ארויסגאנג ערטער', locateMarkedExits: 'געפינט די אנגעצייכנטע ארויסגענג פארן פארן.', inEmergency: 'אין אן עמערדזשענסי: בלייבט רואיג און פאלגט דעם דרייווער׳ס אנווייזונגען.', sideWindows: 'זייטיגע פענצטער', sideWindowsDetail: 'הייבט דעם לאז-שטאנג ביים סיל. שטופט די אונטערשטע טייל פונעם פענצטער ארויס.', roofHatch: 'דאך פתח', roofHatchDetail: 'שטופט ארויף. דרייט דעם קנעפל א פערטל דריי צו “TO EXIT”. שטופט דעם קנעפל, דערנאך דעם פתח ארויס.', frontEntrance: 'פארנט אריינגאנג', frontEntranceDetail: 'דרייט דעם אנגעצייכנטן אינעווייניגער טיר-וואלווז אין דער פייל ריכטונג, דערנאך שטופט די טיר אפן.',
    weatherAlongRoute: 'וועטער אויפן וועג', destinationWeather: 'דעסטינאציע וועטער', offlineWeather: 'אפ-ליין · לעצטער וועטער', weatherDelayed: 'וועטער אפדעיט פארשפעטיגט', liveCoachLocation: 'לייוו ביים קאוטש לאקאציע', currentCoachLocation: 'אקטועלע קאוטש לאקאציע', feelsLike: 'פילט זיך ווי', mph: 'מייל א שעה',
    travelConditions: 'פארן באדינגונגען', offlineConditions: 'אפ-ליין · לעצטע באדינגונגען', conditionsDelayed: 'באדינגונגען קענען זיין פארשפעטיגט', traffic: 'טראפיק', currentCorridor: 'אקטועלע וועג', estimatedArrival: 'געשאצטע אנקום צייט', estimatedDelay: 'געשאצטער פארשפעטיגונג', minutesRemaining: 'מינוט געבליבן', updated: 'אפדעיטעד',
    jewishToday: 'אידישער היינט', updatedAutomatically: 'אפדעיטעד אויטאמאטיש', lastSavedInfo: 'לעצטע געראטעוועטע אינפארמאציע', updating: 'אפדעיטעד', candleLighting: 'נרות צינדן היינט', shabbatEnds: 'שבת ענדיגט היינט',
    dailyZmanim: 'טעגליכע זמני היום', monseyTimes: 'מונסי צייטן · אויטאמאטיש', lastSavedTimes: 'לעצטע געראטעוועטע צייטן', timesUpdate: 'צייטן ווערן אויטאמאטיש אפדעיטעד יעדן טאג', noAnnouncements: 'קיין געראטעוועטע מעלדונגען', passengerInformation: 'פאסאזשירער אינפארמאציע',
    liveAt: 'לייוו ביי', trafficClear: 'פריי', trafficModerate: 'מיטלמעסיג', trafficHeavy: 'שווער', pageOf: 'פון',
    alotHaShachar: 'עלות השחר', earliestTallit: 'משיכיר', sunrise: 'זונ אויפגאנג', latestShemaMGA: 'לעצטער שמע · מג״א', latestShemaGRA: 'לעצטער שמע · גר״א', latestShacharit: 'לעצטע שחרית', chatzot: 'חצות', minchaGedola: 'מנחה גדולה', plagHaMincha: 'פלג המנחה', sunset: 'זונ אונטערגאנג', nightfall: 'נאכטפאל',
    exitLabel: 'ארויסגאנג', manualSource: 'Prevost H-Series דרייווער׳ס מאנואל · סעקציע 7', dafDaily: 'דער היינטיקער דף', hebrewDateLabel: 'אידישער דאטום'
  }
};

export function getTranslation(lang: PassengerLanguage, key: keyof typeof translations['en']): string {
  return translations[lang][key] || translations['en'][key];
}

export function isRTL(lang: PassengerLanguage): boolean {
  return lang === 'he' || lang === 'yi';
}
