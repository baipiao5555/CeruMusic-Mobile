/* Shared classic bootstrap: main WebView, plugin iframe, and opaque Worker. */
(function (global) {
  'use strict';
  if (global.__ceruCompat) return;
  var patched = [];
  var original = {
    objectHasOwn: typeof Object.hasOwn === 'function',
    arrayAt: typeof Array.prototype.at === 'function',
    abortThrowIfAborted: typeof AbortSignal !== 'undefined' && typeof AbortSignal.prototype.throwIfAborted === 'function',
    randomUUID: !!(global.crypto && typeof global.crypto.randomUUID === 'function')
  };
  function install(target, name, value, label) {
    Object.defineProperty(target, name, { value: value, writable: true, configurable: true });
    patched.push(label);
  }
  if (!original.objectHasOwn) {
    install(Object, 'hasOwn', function hasOwn(object, key) {
      if (object === null || object === undefined) throw new TypeError('Object.hasOwn requires an object');
      return Object.prototype.hasOwnProperty.call(Object(object), key);
    }, 'Object.hasOwn');
  }
  if (!original.arrayAt) {
    install(Array.prototype, 'at', function at(index) {
      if (this === null || this === undefined) throw new TypeError('Array.at requires an object');
      var object = Object(this);
      var length = Math.floor(Math.max(0, Math.min(+object.length || 0, 9007199254740991)));
      var relative = +index || 0;
      relative = relative > 0 ? Math.floor(relative) : Math.ceil(relative);
      var position = relative >= 0 ? relative : length + relative;
      return position < 0 || position >= length ? undefined : object[position];
    }, 'Array.at');
    if (typeof Symbol !== 'undefined' && Symbol.unscopables) {
      var unscopables = Array.prototype[Symbol.unscopables];
      if (!unscopables) {
        unscopables = Object.create(null);
        Object.defineProperty(Array.prototype, Symbol.unscopables, { value: unscopables, configurable: true });
      }
      unscopables.at = true;
    }
  }
  if (typeof AbortSignal !== 'undefined' && !original.abortThrowIfAborted) {
    var aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
    install(AbortSignal.prototype, 'throwIfAborted', function throwIfAborted() {
      // Use the native getter for its brand check; never swallow cancellation.
      if (!aborted.call(this)) return;
      if ('reason' in this) throw this.reason;
      if (typeof DOMException === 'function') throw new DOMException('This operation was aborted', 'AbortError');
      var error = new Error('This operation was aborted');
      error.name = 'AbortError';
      throw error;
    }, 'AbortSignal.throwIfAborted');
  }
  if (!original.randomUUID && global.crypto && typeof global.crypto.getRandomValues === 'function') {
    // Share the existing CSPRNG fallback with parent WebView, iframe and Worker.
    // Never substitute Math.random or expand plugin permissions.
    var secureRandom = global.crypto.getRandomValues.bind(global.crypto);
    install(global.crypto, 'randomUUID', function randomUUID() {
      var bytes = secureRandom(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
      return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    }, 'crypto.randomUUID');
  }
  var chromium = global.navigator && global.navigator.userAgent.match(/(?:Chrome|Chromium)\/([\d.]+)/);
  global.__ceruCompat = { original: original, patched: patched, chromium: chromium ? chromium[1] : '' };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
