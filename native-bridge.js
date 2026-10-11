/* =========================================================================
 * Kelimşek Native Bridge (Capacitor / Android)
 * MASTER KOPYA: kelimsek-app/bridge/native-bridge.js
 * www/ her sync-web'de silbaştan yazılır; bu dosya oraya otomatik kopyalanır.
 *
 * Görevler:
 *  - window.KelimsekNative API'sini tanımlar
 *  - Native'deyken web uygulamasının stub'larını (watchAd/buyPack/buyPro)
 *    monkey-patch ile gerçek AdMob Rewarded + Play Billing'e bağlar
 *    (../simsek/index.html'e ASLA dokunulmaz)
 *  - Günlük hatırlatma bildirimini (19:30) kurar
 * ========================================================================= */
(function () {
  'use strict';

  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  /* ------------------------------------------------------------------ *
   *  GERÇEK ID'LER BURAYA — şu an Google'ın RESMİ TEST ID'leri kullanılıyor
   * ------------------------------------------------------------------ */
  var ADMOB = {
    // TEST rewarded ad unit (Google resmi test ID'si). Yayına çıkmadan önce
    // AdMob konsolundan aldığın gerçek Rewarded unit ID ile değiştir:
    rewardedAdId: 'ca-app-pub-3940256099942544/5224354917', // <-- GERÇEK REWARDED UNIT ID
    // Uygulama seviyesindeki AdMob APP ID AndroidManifest.xml'de tanımlı
    // (android/app/src/main/AndroidManifest.xml içindeki meta-data).
    useTesting: true // yayında false yap
  };

  // Play Console'da tanımlanacak ürün ID'leri (in-app, non-consumable)
  var PRODUCTS = {
    pro: 'pro_lifetime',
    packs: { yks: 'pack_yks', kpss: 'pack_kpss', yds: 'pack_yds' }
  };
  function productForPack(key) {
    return PRODUCTS.packs[key] || ('pack_' + String(key));
  }

  /* ------------------------------------------------------------------ */
  var Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  var AdMob = Plugins.AdMob;
  var LocalNotifications = Plugins.LocalNotifications;

  var state = {
    admobReady: false,
    storeReady: false,
    pendingPackKey: null // openUnlock ile açılan paketin anahtarı
  };

  /* ================= AdMob Rewarded ================= */
  function initAdMob() {
    if (!AdMob) return Promise.resolve();
    return AdMob.initialize({
      initializeForTesting: ADMOB.useTesting
    }).then(function () { state.admobReady = true; })
      .catch(function (e) { console.warn('[bridge] AdMob init hatası', e); });
  }

  function showRewarded(onReward, onFail) {
    if (!AdMob) { onFail && onFail(new Error('AdMob yok')); return; }
    var rewarded = false;
    var subs = [];
    function cleanup() {
      subs.forEach(function (p) { p.then(function (h) { h.remove(); }).catch(function(){}); });
      subs = [];
    }
    subs.push(AdMob.addListener('onRewardedVideoAdReward', function () {
      rewarded = true;
    }));
    subs.push(AdMob.addListener('onRewardedVideoAdDismissed', function () {
      cleanup();
      if (rewarded) { onReward && onReward(); }
      else { onFail && onFail(new Error('Reklam ödül vermeden kapatıldı')); }
    }));
    subs.push(AdMob.addListener('onRewardedVideoAdFailedToLoad', function (e) {
      cleanup(); onFail && onFail(e);
    }));
    subs.push(AdMob.addListener('onRewardedVideoAdFailedToShow', function (e) {
      cleanup(); onFail && onFail(e);
    }));
    AdMob.prepareRewardVideoAd({ adId: ADMOB.rewardedAdId })
      .then(function () { return AdMob.showRewardVideoAd(); })
      .catch(function (e) { cleanup(); onFail && onFail(e); });
  }

  /* ================= Play Billing (cordova-plugin-purchase v13) ======= */
  var purchaseCallbacks = {}; // productId -> {resolve, reject}

  function initStore() {
    var CdvPurchase = window.CdvPurchase;
    if (!CdvPurchase) { console.warn('[bridge] CdvPurchase yok'); return; }
    var store = CdvPurchase.store;
    var ids = [PRODUCTS.pro, PRODUCTS.packs.yks, PRODUCTS.packs.kpss, PRODUCTS.packs.yds];
    store.register(ids.map(function (id) {
      return { id: id, type: CdvPurchase.ProductType.NON_CONSUMABLE, platform: CdvPurchase.Platform.GOOGLE_PLAY };
    }));
    store.when()
      .approved(function (transaction) { transaction.verify(); })
      .verified(function (receipt) { receipt.finish(); })
      .finished(function (transaction) {
        (transaction.products || []).forEach(function (p) {
          var cb = purchaseCallbacks[p.id];
          if (cb) { delete purchaseCallbacks[p.id]; cb.resolve(p.id); }
        });
      });
    store.initialize([CdvPurchase.Platform.GOOGLE_PLAY])
      .then(function () { state.storeReady = true; })
      .catch(function (e) { console.warn('[bridge] store init hatası', e); });
  }

  function purchase(productId) {
    return new Promise(function (resolve, reject) {
      var CdvPurchase = window.CdvPurchase;
      if (!CdvPurchase || !state.storeReady) { reject(new Error('Mağaza hazır değil')); return; }
      var offer = CdvPurchase.store.get(productId, CdvPurchase.Platform.GOOGLE_PLAY);
      offer = offer && offer.getOffer();
      if (!offer) { reject(new Error('Ürün bulunamadı: ' + productId)); return; }
      purchaseCallbacks[productId] = { resolve: resolve, reject: reject };
      offer.order().then(function (err) {
        if (err) { delete purchaseCallbacks[productId]; reject(err); }
      });
    });
  }

  /* ================= Günlük bildirim (19:30) ================= */
  function notifySchedule() {
    if (!LocalNotifications) return Promise.resolve();
    return LocalNotifications.requestPermissions().then(function (perm) {
      if (!perm || perm.display !== 'granted') return;
      // idempotent: aynı id (1001) yeniden zamanlanır, çift bildirim olmaz
      return LocalNotifications.cancel({ notifications: [{ id: 1001 }] }).catch(function(){})
        .then(function () {
          return LocalNotifications.schedule({
            notifications: [{
              id: 1001,
              title: 'Kelimşek ⚡',
              body: 'Günlük Kelimşek seni bekliyor ⚡',
              schedule: { on: { hour: 19, minute: 30 }, allowWhileIdle: true }
            }]
          });
        });
    }).catch(function (e) { console.warn('[bridge] bildirim hatası', e); });
  }

  /* ================= Public API ================= */
  window.KelimsekNative = {
    isNative: isNative,
    showRewarded: showRewarded,
    purchase: purchase,
    notifySchedule: notifySchedule,
    _state: state
  };

  if (!isNative) return; // Tarayıcı/PWA: stub'lara dokunma, web simülasyonu çalışsın

  /* ================= Web stub'larını monkey-patch et =================
   * index.html'deki fonksiyonlar top-level function declaration olduğu
   * için window üzerinde yaşar; burada sarmalıyoruz. `pending` closure
   * değişkenine erişemediğimizden openUnlock'u da sararak paket
   * anahtarını yakalıyoruz. Ödül/satın alma başarılı olunca ORİJİNAL
   * stub'ı çağırıyoruz: kilit açma + kaydetme mantığı web tarafında kalır.
   * =================================================================== */
  function patchStubs() {
    var _openUnlock = window.openUnlock;
    var _watchAd = window.watchAd;
    var _buyPack = window.buyPack;
    var _buyPro = window.buyPro;
    if (typeof _watchAd !== 'function' || typeof _openUnlock !== 'function') {
      console.warn('[bridge] web stubları bulunamadı, patch atlandı');
      return;
    }

    window.openUnlock = function (k) {
      state.pendingPackKey = k;
      return _openUnlock.apply(this, arguments);
    };

    window.watchAd = function () {
      showRewarded(
        function onReward() { _watchAd(); }, // orijinal stub günlük kilidi açar
        function onFail(e) {
          console.warn('[bridge] rewarded başarısız', e);
          alert('Reklam şu an yüklenemedi, lütfen tekrar dene.');
        }
      );
    };

    window.buyPack = function () {
      var pid = productForPack(state.pendingPackKey);
      purchase(pid).then(function () { _buyPack(); })
        .catch(function (e) {
          console.warn('[bridge] satın alma başarısız', e);
          if (e && !/cancel/i.test(String(e.message || e))) {
            alert('Satın alma tamamlanamadı.');
          }
        });
    };

    if (typeof _buyPro === 'function') {
      window.buyPro = function () {
        purchase(PRODUCTS.pro).then(function () { _buyPro(); })
          .catch(function (e) {
            console.warn('[bridge] pro satın alma başarısız', e);
            if (e && !/cancel/i.test(String(e.message || e))) {
              alert('Satın alma tamamlanamadı.');
            }
          });
      };
    }
  }

  function boot() {
    patchStubs();
    initAdMob();
    notifySchedule();
    // cordova plugin'i deviceready sonrası hazır olur
    if (window.CdvPurchase) { initStore(); }
    else { document.addEventListener('deviceready', initStore, false); }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
