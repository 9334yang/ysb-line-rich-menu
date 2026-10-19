(() => {
  let credential = '';
  const base = (window.YSB_API_BASE || '').replace(/\/$/, '');
  async function request(method, args) {
    const response = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ method, args })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '後端連線失敗');
    return result;
  }
  function runner(success = () => {}, failure = console.error) {
    return new Proxy({}, { get(_, key) {
      if (key === 'withSuccessHandler') return fn => runner(fn, failure);
      if (key === 'withFailureHandler') return fn => runner(success, fn);
      return (...args) => request(key, args).then(success).catch(failure);
    }});
  }
  window.backend = {
    get run() { return runner(); },
    async initialize(onLogin) {
      try {
        const response = await fetch(`${base}/api/config`);
        if (!response.ok) throw new Error('後端尚未完成設定');
        const config = await response.json();
        if (!config.googleClientId) throw new Error('後端尚未設定 Google Client ID');
        if (!window.google?.accounts?.id) throw new Error('Google 登入載入失敗，請重新整理');
        google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: result => { credential = result.credential; onLogin(); }
        });
        google.accounts.id.renderButton(document.getElementById('google-login'), { theme: 'outline', size: 'large' });
        document.getElementById('login-status').textContent = '請使用管理員 Google 帳號登入（登入有效期約一小時，過期請重新整理登入）';
      } catch (error) {
        document.getElementById('login-status').textContent = error.message;
      }
    }
  };
})();
