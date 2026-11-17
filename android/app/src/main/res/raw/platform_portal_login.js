/* Presentation only: original forms, permission checkboxes and callbacks remain untouched. */
(function(platform) {
  function style(text) {
    var s = document.getElementById('ceru-platform-presentation');
    if (!s) { s = document.createElement('style'); s.id = 'ceru-platform-presentation'; document.head.appendChild(s); }
    s.textContent = text;
  }
  function isolate(panel) {
    var current = panel;
    while (current && current !== document.body) {
      var parent = current.parentElement;
      if (!parent) break;
      Array.prototype.forEach.call(parent.children, function(sibling) {
        var authenticationOverlay = /captcha|verify|dialog|modal|mask|popup|layer|toast/i.test(sibling.id + ' ' + sibling.className);
        if (sibling !== current && sibling.tagName !== 'SCRIPT' && sibling.tagName !== 'STYLE' && sibling.tagName !== 'IFRAME' && !authenticationOverlay) sibling.classList.add('ceru-non-login');
      });
      parent.classList.add('ceru-login-ancestor'); current = parent;
    }
  }
  var common = 'html,body{background:#fff!important;margin:0!important;color:#172b25!important;} .ceru-non-login{display:none!important;} .ceru-login-ancestor{width:100%!important;min-width:0!important;max-width:none!important;height:auto!important;min-height:0!important;position:static!important;padding:0!important;margin:0!important;transform:none!important;overflow:visible!important;}';
  if (platform === 'tx') {
    if (location.hostname !== 'y.qq.com') return { ready:false };
    var loginButton = document.querySelector('.top_login__link, .profile_unlogin__btn');
    if (!loginButton) return { ready:true };
    if (!window.__ceruQQLoginRequested) {
      window.__ceruQQLoginRequested = true;
      loginButton.click();
    }
    style(common + ' html,body{overflow:hidden!important;width:100%!important;} body>*:not(.yqq-dialog-root){visibility:hidden!important;} .yqq-dialog-root{visibility:visible!important;width:100%!important;} .yqq-dialog-mask{background:#fff!important;} .yqq-dialog-wrap{position:fixed!important;inset:0!important;display:block!important;} .yqq-dialog{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;margin:0!important;transform:none!important;max-width:none!important;} .yqq-dialog-content,.yqq-dialog-body,.login-box,.login-box-bd,.login-box-bd__item{width:100%!important;height:auto!important;min-height:0!important;} .login-box-bd__ifr{width:100%!important;height:calc(100vh - 110px)!important;border:0!important;}');
    if (!document.querySelector('.yqq-dialog-root')) {
      setTimeout(function() {
        var retry = document.querySelector('.top_login__link, .profile_unlogin__btn');
        if (retry && !window.__ceruQQLoginRetried) { window.__ceruQQLoginRetried = true; retry.click(); }
      }, 350);
      return { ready:false };
    }
    return { ready:true };
  }
  if (platform === 'kg') {
    if (location.hostname !== 'm.kugou.com' || location.pathname !== '/loginReg.php') return { ready:false };
    style(common + '.login-index-top{height:180px!important;background:#f2f8ff!important;} .login-index-btn-box{padding:0 24px!important;} .login-index-btn-box>div{border-radius:12px!important;min-height:46px!important;line-height:46px!important;font-size:14px!important;} .login-index-tips{font-size:11px!important;color:#73817b!important;} .js-input{border:1px solid #e1e9e4!important;border-radius:10px!important;min-height:46px!important;font-size:15px!important;padding:10px!important;box-sizing:border-box!important;} .btn{border-radius:12px!important;} .box-agreement{font-size:11px!important;}');
    return { ready:true };
  }
  if (platform === 'kw') {
    if (location.hostname !== 'www.kuwo.cn') return { ready:false };
    var panel = document.querySelector('.reg_login');
    if (!panel || getComputedStyle(panel).display === 'none') {
      var opener = Array.prototype.filter.call(document.querySelectorAll('.reg_text span,.reg_text a'), function(e) { return e.textContent.trim() === '登录'; })[0] || document.querySelector('.reg_text');
      if (opener) opener.click(); panel = document.querySelector('.reg_login');
    }
    if (!panel || getComputedStyle(panel).display === 'none') return { ready:false };
    if (!panel.getAttribute('data-ceru-account-view')) {
      var account = Array.prototype.filter.call(panel.querySelectorAll('span,p,a,button'), function(e) { return e.textContent.trim() === '酷我帐号'; })[0];
      if (account) account.click(); panel.setAttribute('data-ceru-account-view','1');
    }
    isolate(panel);
    style(common + '.reg_login{position:relative!important;left:auto!important;top:auto!important;width:100%!important;height:auto!important;min-height:420px!important;background:#fff!important;} .reg_login .login{position:relative!important;left:auto!important;top:auto!important;width:calc(100% - 40px)!important;max-width:420px!important;min-height:0!important;height:auto!important;margin:0 auto!important;padding:24px 0!important;transform:none!important;box-shadow:none!important;} .reg_login .login_item{flex-wrap:wrap!important;justify-content:center!important;gap:16px!important;} .reg_login .login_item>div{flex:0 1 38%!important;} .reg_login .account{width:100%!important;padding:0!important;} .reg_login input:not([type=checkbox]):not([type=submit]){width:100%!important;min-height:46px!important;border:1px solid #e1e9e4!important;border-radius:11px!important;font-size:15px!important;box-sizing:border-box!important;} .reg_login .sub_btn{width:100%!important;min-height:48px!important;background:#12ad70!important;color:white!important;border:0!important;border-radius:11px!important;font-size:14px!important;}');
    return { ready:true };
  }
  if (platform === 'mg') {
    if (location.hostname !== 'music.migu.cn') return { ready:false };
    var container = document.querySelector('.login-container');
    if (!container || !container.querySelector('.migu-auth-dialog__iframe')) {
      var login = document.querySelector('.migu-login .login'); if (login) login.click(); container = document.querySelector('.login-container');
    }
    if (!container || !container.querySelector('.migu-auth-dialog__iframe')) return { ready:false };
    isolate(container);
    style(common + '.login-container,#login-content{position:relative!important;left:auto!important;top:auto!important;width:100%!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;transform:none!important;} .migu-auth-dialog,.migu-auth-dialog__wrap{position:relative!important;left:auto!important;top:auto!important;max-width:100%!important;width:100%!important;height:auto!important;margin:0!important;padding:0!important;transform:none!important;background:#fff!important;} .migu-auth-dialog__iframe{display:block!important;width:100%!important;height:calc(100vh - 16px)!important;max-height:none!important;border:0!important;}');
    return { ready:true };
  }
  return { ready:false };
})
