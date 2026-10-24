/* image_gate.js — app-wide client-side enforcement of the Pro image gate.
   Two duties:
     1. Pre-check on selection time via window.gateImageFeature()
        (defined in base.html from server truth).
     2. Listen: any fetch returning a JSON body with { upgrade_required: true }
        (403 from the server gates) opens the Pro upsell modal automatically.
   The original response is returned untouched, so existing handlers keep working.
*/
(function () {
  'use strict';

  var _origFetch = window.fetch;
  if (typeof _origFetch !== 'function') return;

  window.fetch = function (input, init) {
    return _origFetch.call(this, input, init).then(function (res) {
      // Only sniff JSON-ish responses so we don't clone huge binary payloads.
      var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (res.status === 403 && /json/i.test(ct)) {
        res.clone().json().then(function (body) {
          if (body && body.upgrade_required) {
            if (typeof window.openImageProModal === 'function') {
              window.openImageProModal(body);
            } else if (typeof window.gateImageFeature === 'function') {
              window.gateImageFeature(body);
            }
          }
        }).catch(function () { /* not JSON / unreadable — ignore */ });
      }
      return res;
    });
  };
})();
