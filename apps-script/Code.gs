function ysbCheckPublishStatus(authToken) {
  ysbRequireAuth_(authToken);
  return ysbCheckPublishStatusInternal_();
}

function ysbRemoveDefaultRichMenu(authToken) {
  ysbRequireAuth_(authToken);
  return ysbRemoveDefaultRichMenuInternal_();
}

function ysbPublishDefaultRichMenu(authToken) {
  ysbRequireAuth_(authToken);
  return ysbPublishDefaultRichMenuInternal_();
}

function ysbPrepareRichMenus(authToken) {
  ysbRequireAuth_(authToken);
  return ysbPrepareRichMenusInternal_();
}

function ysbGetMenuImageData(tab, authToken) {
  ysbRequireAuth_(authToken);
  return ysbGetMenuImageDataInternal_(tab);
}

function ysbUploadMenuImage(tab, dataUrl, fileName, authToken) {
  ysbRequireAuth_(authToken);
  return ysbUploadMenuImageInternal_(tab, dataUrl, fileName);
}

function ysbGetImageSettings(authToken) {
  ysbRequireAuth_(authToken);
  return ysbGetImageSettingsInternal_();
}

function saveMenuDraft(value, authToken) {
  ysbRequireAuth_(authToken);
  return saveMenuDraftInternal_(value);
}

function getMenuDraft(authToken) {
  ysbRequireAuth_(authToken);
  return getMenuDraftInternal_();
}


/**
 * 氧身部落 LINE Rich Menu Manager V2
 * 雙分頁 × 六宮格 × 圖片管理 × LINE 發布
 *
 * 重要：
 * GAS 網頁請限制管理人員存取。
 * 不要將 LINE Token 寫在 HTML 或公開程式碼中。
 */

const YSB_DRAFT_KEY = 'YSB_RICH_MENU_DRAFT_V1';
const YSB_IMAGE_STATE_KEY = 'YSB_RICH_MENU_IMAGES_V2';
const YSB_IMAGE_FOLDER_KEY = 'YSB_IMAGE_FOLDER_ID';
const YSB_LINE_STATE_KEY = 'YSB_LINE_PUBLISH_STATE_V2';

const YSB_LINE_API = 'https://api.line.me/v2/bot';
const YSB_LINE_DATA_API = 'https://api-data.line.me/v2/bot';

const YSB_TABS = ['about', 'member'];
const YSB_MAX_IMAGE_BYTES = 1024 * 1024;


// ========================================
// 一、原本 V1 草稿功能
// ========================================

function initialMenus_() {
  return {
    about: {
      title: '關於我們',
      items: []
    },
    member: {
      title: '會員專區',
      items: []
    }
  };
}

function ysbEscapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function doGet() {
  try { ysbRequireAuth_(); } catch (e) {
    return HtmlService.createHtmlOutput('<meta charset="utf-8"><h2>氧身部落｜存取遭拒</h2><p>' + ysbEscapeHtml_(e.message) + '</p>');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('氧身部落｜LINE 圖文選單管理');
}

function getMenuDraftInternal_() {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(YSB_DRAFT_KEY);

  if (!raw) return initialMenus_();

  try {
    return normalizeMenus_(JSON.parse(raw));
  } catch (e) {
    throw new Error('草稿讀取失敗：' + e.message);
  }
}

function normalizeMenus_(value) {
  const result = initialMenus_();

  for (const key of YSB_TABS) {
    if (
      !value ||
      !value[key] ||
      !Array.isArray(value[key].items) ||
      value[key].items.length > 18
    ) {
      throw new Error('每個分頁最多 18 個自訂區塊');
    }

    result[key].items = value[key].items.map(
      (item, i) => {
        const name = String(
          (item && item.name) || ''
        ).trim();

        const url = String(
          (item && item.url) || ''
        ).trim();

        if (name.length > 32) {
          throw new Error(
            result[key].title +
            '第 ' + (i + 1) + ' 格名稱過長'
          );
        }

        if (url.length > 2000) {
          throw new Error('網址長度不可超過 2000 字');
        }

        if (url) {
          if (!/^https:\/\/[^/\s?#]+/i.test(url)) {
            throw new Error(
              result[key].title +
              '第 ' + (i + 1) +
              ' 格必須使用有效的 HTTPS 網址'
            );
          }
        }

        const b = item && item.bounds;
        // Legacy six-grid drafts are migrated to their original positions.
        const legacy = !b;
        const col = i % 3, row = Math.floor(i / 3);
        const defaults = {x:[0,834,1667][col],y:300+row*693,width:[834,833,833][col],height:693};
        const bounds = legacy ? defaults : {
          x:Number(b.x),y:Number(b.y),width:Number(b.width),height:Number(b.height)
        };
        for (const k of ['x','y','width','height']) {
          if (!Number.isInteger(bounds[k])) throw new Error('區塊座標必須是整數');
        }
        if (bounds.width < 1 || bounds.height < 1 || bounds.x < 0 || bounds.y < 300 ||
            bounds.x + bounds.width > 2500 || bounds.y + bounds.height > 1686) {
          throw new Error('第 '+(i+1)+' 個區塊超出可編輯範圍');
        }
        const shape = ['rectangle','square','ellipse'].includes(item.shape) ? item.shape : 'rectangle';
        return {name:name,url:url,bounds:bounds,shape:shape};
      }
    );
  }

  return result;
}

function saveMenuDraftInternal_(value) {
  const menus = normalizeMenus_(value);
  const lock = LockService.getScriptLock();

  lock.waitLock(10000);

  try {
    PropertiesService.getScriptProperties()
      .setProperty(
        YSB_DRAFT_KEY,
        JSON.stringify(menus)
      );
  } finally {
    lock.releaseLock();
  }

  return {
    ok: true,
    savedAt: new Date().toISOString()
  };
}


// ========================================
// 二、圖片管理
// ========================================

function ysbCheckTab_(tab) {
  if (!YSB_TABS.includes(tab)) {
    throw new Error('無效的選單分頁');
  }
}

function ysbGetImageState_() {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(YSB_IMAGE_STATE_KEY);

  return raw ? JSON.parse(raw) : {};
}

function ysbGetImageSettingsInternal_() {
  const state = ysbGetImageState_();
  const result = {};

  YSB_TABS.forEach(function(tab) {
    const item = state[tab];

    result[tab] = item ? {
      name: item.name,
      updatedAt: item.updatedAt
    } : null;
  });

  return result;
}

function ysbGetImageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(YSB_IMAGE_FOLDER_KEY);

  if (id) return DriveApp.getFolderById(id);

  const folder = DriveApp.createFolder(
    'YSB LINE Rich Menu Images'
  );

  props.setProperty(
    YSB_IMAGE_FOLDER_KEY,
    folder.getId()
  );

  return folder;
}

function ysbUploadMenuImageInternal_(tab, dataUrl, fileName) {
  ysbCheckTab_(tab);

  const match = String(dataUrl || '').match(
    /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) {
    throw new Error('圖片格式必須為 PNG 或 JPEG');
  }

  const bytes = Utilities.base64Decode(match[2]);

  if (bytes.length > YSB_MAX_IMAGE_BYTES) {
    throw new Error('圖片不得超過 1 MB');
  }

  const mime = match[1];
  const ext = mime === 'image/png' ? '.png' : '.jpg';

  const blob = Utilities.newBlob(
    bytes,
    mime,
    'YSB_' + tab + '_' + Date.now() + ext
  );

  const folder = ysbGetImageFolder_();
  const file = folder.createFile(blob);

  const state = ysbGetImageState_();

  state[tab] = {
    fileId: file.getId(),
    name: String(fileName || file.getName())
      .slice(0, 120),
    updatedAt: new Date().toISOString()
  };

  const props = PropertiesService.getScriptProperties();

  props.setProperty(
    YSB_IMAGE_STATE_KEY,
    JSON.stringify(state)
  );

  const propertyName = tab === 'about'
    ? 'LINE_MENU_IMAGE_ABOUT_FILE_ID'
    : 'LINE_MENU_IMAGE_MEMBER_FILE_ID';

  props.setProperty(propertyName, file.getId());

  return {
    ok: true,
    name: state[tab].name,
    updatedAt: state[tab].updatedAt
  };
}

function ysbGetMenuImageDataInternal_(tab) {
  ysbCheckTab_(tab);

  const state = ysbGetImageState_();
  let item = state[tab];

  // 相容先前手動設定的圖片 ID
  if (!item) {
    const propertyName = tab === 'about'
      ? 'LINE_MENU_IMAGE_ABOUT_FILE_ID'
      : 'LINE_MENU_IMAGE_MEMBER_FILE_ID';

    const id = PropertiesService.getScriptProperties()
      .getProperty(propertyName);

    if (!id) return null;

    item = {
      fileId: id,
      name: '已設定的選單圖片',
      updatedAt: null
    };
  }

  const blob = DriveApp.getFileById(item.fileId)
    .getBlob();

  return {
    dataUrl:
      'data:' + blob.getContentType() +
      ';base64,' +
      Utilities.base64Encode(blob.getBytes()),
    name: item.name,
    updatedAt: item.updatedAt
  };
}

function ysbGetMenuImage_(propertyName) {
  const id = PropertiesService.getScriptProperties()
    .getProperty(propertyName);

  if (!id) {
    throw new Error('尚未上傳圖片：' + propertyName);
  }

  const blob = DriveApp.getFileById(id).getBlob();

  if (!['image/png', 'image/jpeg'].includes(
    blob.getContentType()
  )) {
    throw new Error('LINE 圖片格式必須為 PNG/JPEG');
  }

  if (blob.getBytes().length > YSB_MAX_IMAGE_BYTES) {
    throw new Error('LINE 圖片不得超過 1 MB');
  }

  return blob;
}


// ========================================
// 三、LINE API
// ========================================

function ysbLineRequest_(
  method,
  path,
  payload,
  isImage
) {
  const token = PropertiesService.getScriptProperties()
    .getProperty('LINE_CHANNEL_ACCESS_TOKEN');

  if (!token) {
    throw new Error('尚未設定 LINE_CHANNEL_ACCESS_TOKEN');
  }

  const options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token
    },
    muteHttpExceptions: true
  };

  if (payload !== undefined) {
    if (isImage) {
      options.contentType = payload.getContentType();
      options.payload = payload.getBytes();
    } else {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(payload);
    }
  }

  const base = isImage
    ? YSB_LINE_DATA_API
    : YSB_LINE_API;

  const response = UrlFetchApp.fetch(
    base + path,
    options
  );

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      'LINE API 錯誤 HTTP ' +
      status + '：' + body
    );
  }

  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch (e) {
    return {raw: body};
  }
}


// ========================================
// 四、建立 Rich Menu
// ========================================

function ysbBuildRichMenu_(key, aliases, draft) {
  const W = 2500;
  const H = 1686;
  const TAB_H = 300;

  const areas = [];

  // 上方雙分頁
  for (let i = 0; i < 2; i++) {
    areas.push({
      bounds: {
        x: i * 1250,
        y: 0,
        width: 1250,
        height: TAB_H
      },
      action: {
        type: 'richmenuswitch',
        richMenuAliasId: aliases[i],
        data: 'tab=' + YSB_TABS[i]
      }
    });
  }

  draft[key].items.forEach(function(item) {
    if (!item.url) return;
    areas.push({bounds:item.bounds,action:{type:'uri',uri:item.url}});
  });

  return {
    size: {
      width: W,
      height: H
    },
    selected: true,
    name: 'YSB ' + key + ' ' + Date.now(),
    chatBarText: '氧身服務選單',
    areas: areas
  };
}


// ========================================
// 五、LINE 發布狀態
// ========================================

function ysbGetPublishState_() {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(YSB_LINE_STATE_KEY);

  return raw ? JSON.parse(raw) : {};
}

function ysbSavePublishState_(state) {
  PropertiesService.getScriptProperties()
    .setProperty(
      YSB_LINE_STATE_KEY,
      JSON.stringify(state)
    );
}


// ========================================
// 六、準備新版選單（不公開）
// ========================================

function ysbPrepareRichMenusInternal_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const props = PropertiesService.getScriptProperties();
    const draft = getMenuDraftInternal_();

    const images = [
      ysbGetMenuImage_(
        'LINE_MENU_IMAGE_ABOUT_FILE_ID'
      ),
      ysbGetMenuImage_(
        'LINE_MENU_IMAGE_MEMBER_FILE_ID'
      )
    ];

    // 防止未填完就意外發布
    YSB_TABS.forEach(function(tab) {
      if (!draft[tab].items.length) throw new Error(draft[tab].title+'尚未建立點擊區塊');
      draft[tab].items.forEach(function(item, i) {
        if (!item.name || !item.url) {
          throw new Error(
            draft[tab].title +
            '第 ' + (i + 1) +
            ' 格尚未填妥名稱或網址'
          );
        }
      });
    });

    const state = ysbGetPublishState_();

    // Alias 固定，日後可指向新版選單
    if (!state.aliases) {
      const suffix = Utilities.getUuid()
        .replace(/-/g, '')
        .slice(0, 10);

      state.aliases = [
        'ysb-about-' + suffix,
        'ysb-member-' + suffix
      ];

      ysbSavePublishState_(state);
    }

    const newMenus = [];

    // 每次準備時建立新版，不覆寫舊選單
    for (let i = 0; i < 2; i++) {
      const body = ysbBuildRichMenu_(
        YSB_TABS[i],
        state.aliases,
        draft
      );

      const created = ysbLineRequest_(
        'post',
        '/richmenu',
        body,
        false
      );

      const id = created.richMenuId;

      if (!id) {
        throw new Error('LINE 未回傳 Rich Menu ID');
      }

      newMenus.push(id);

      ysbLineRequest_(
        'post',
        '/richmenu/' + id + '/content',
        images[i],
        true
      );
    }

    // 第一次建立 Alias，之後更新指向
    for (let i = 0; i < 2; i++) {
      const aliasId = state.aliases[i];

      // 以 LINE 實際 Alias 為準，避免前次部分發布造成重複建立。
      const currentAliases = ysbLineRequest_(
        'get', '/richmenu/alias/list', undefined, false
      ).aliases || [];
      const exists = currentAliases.some(function(a) {
        return a.richMenuAliasId === aliasId;
      });
      if (exists) {
        ysbLineRequest_(
          'post',
          '/richmenu/alias/' + aliasId,
          {richMenuId: newMenus[i]},
          false
        );
      } else {
        ysbLineRequest_(
          'post',
          '/richmenu/alias',
          {
            richMenuAliasId: aliasId,
            richMenuId: newMenus[i]
          },
          false
        );
      }

      state.aliasCreated = state.aliasCreated ||
        [false, false];

      state.aliasCreated[i] = true;
      ysbSavePublishState_(state);
    }

    state.preparedMenus = newMenus;
    state.preparedAt = new Date().toISOString();

    ysbSavePublishState_(state);

    Logger.log('新版選單準備完成，尚未設定為預設');
    Logger.log(JSON.stringify(newMenus));

    return state;

  } finally {
    lock.releaseLock();
  }
}


// ========================================
// 七、正式發布給官方帳號使用者
// ========================================

function ysbPublishDefaultRichMenuInternal_() {
  const state = ysbGetPublishState_();
  const newMenus = state.preparedMenus || [];
  if (newMenus.length !== 2 || !state.aliasCreated ||
      !state.aliasCreated.every(Boolean)) {
    throw new Error('請先建立兩個新版圖文選單與 Alias');
  }

  // 先切換全體預設選單，再確認 LINE 端已生效。
  ysbLineRequest_('post', '/user/all/richmenu/' +
    encodeURIComponent(newMenus[0]), undefined, false);
  const actual = ysbLineRequest_('get',
    '/user/all/richmenu', undefined, false);
  if (actual.richMenuId !== newMenus[0]) {
    throw new Error('LINE 預設選單未指向新版，停止清理舊版');
  }

  const old = (state.publishedMenus || []).filter(function(id) {
    return id && newMenus.indexOf(id) === -1;
  });
  const pending = (state.pendingCleanupMenus || []).concat(old);
  state.publishedMenus = newMenus.slice();
  state.pendingCleanupMenus = Array.from(new Set(pending))
    .filter(function(id) { return newMenus.indexOf(id) === -1; });
  state.published = true;
  state.publishedAt = new Date().toISOString();
  ysbSavePublishState_(state);
  return state;
}

// 僅刪除本程式歷次發布留下的 Rich Menu。
// 刪除舊選單會解除其使用者綁定，使用者之後會使用新預設選單；
// 不會清理其他系統或 LINE 官方後台建立的選單。
function ysbCleanupPublishedMenus() {
  ysbRequireAuth_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return ysbCleanupPublishedMenusInternal_();
  } finally {
    lock.releaseLock();
  }
}

function ysbCleanupPublishedMenusInternal_() {
  const state = ysbGetPublishState_();
  const active = state.publishedMenus || [];
  const pending = state.pendingCleanupMenus || [];
  const result = {deleted:[], failed:[], retained:[]};
  if (!pending.length) return result;

  const actual = ysbLineRequest_('get',
    '/user/all/richmenu', undefined, false);
  if (actual.richMenuId !== active[0]) {
    throw new Error('預設選單與本次發布不一致，禁止刪除舊選單');
  }

  // 驗證兩個 Alias 均已指向最新版本，避免刪掉仍在使用的選單。
  const aliases = ysbLineRequest_('get',
    '/richmenu/alias/list', undefined, false).aliases || [];
  (state.aliases || []).forEach(function(aliasId, i) {
    const match = aliases.find(function(a) {
      return a.richMenuAliasId === aliasId;
    });
    if (!match || match.richMenuId !== active[i]) {
      throw new Error('Alias ' + aliasId + ' 尚未指向新版，停止清理');
    }
  });

  pending.forEach(function(id) {
    if (!id || active.indexOf(id) !== -1) {
      result.retained.push(id);
      return;
    }
    try {
      ysbLineRequest_('delete', '/richmenu/' +
        encodeURIComponent(id), undefined, false);
      result.deleted.push(id);
    } catch (e) {
      result.failed.push({id:id, error:String(e.message || e)});
    }
  });
  state.pendingCleanupMenus = result.failed.map(function(x) {
    return x.id;
  });
  ysbSavePublishState_(state);
  return result;
}

// ========================================
// 八、解除 API 預設選單
// ========================================

function ysbRemoveDefaultRichMenuInternal_() {
  ysbLineRequest_(
    'delete',
    '/user/all/richmenu',
    undefined,
    false
  );

  const state = ysbGetPublishState_();

  state.published = false;
  ysbSavePublishState_(state);

  Logger.log('已解除 API 預設選單');
}


// ========================================
// 九、查詢 LINE 目前預設選單
// ========================================

function ysbCheckPublishStatusInternal_() {
  const state = ysbGetPublishState_();

  Logger.log(
    'GAS 狀態：' + JSON.stringify(state)
  );

  try {
    const result = ysbLineRequest_(
      'get',
      '/user/all/richmenu',
      undefined,
      false
    );

    Logger.log(
      'LINE 預設選單：' + JSON.stringify(result)
    );
  } catch (e) {
    Logger.log(
      '查詢失敗或尚無 API 預設選單：' +
      e.message
    );
  }
}


/**
 * 後台一鍵發布 LINE Rich Menu

 */
function ysbPublishFromAdmin(menus, authToken) {
  ysbRequireAuth_(authToken);
  const saved = saveMenuDraftInternal_(menus);
  if (!saved || !saved.ok) {
    throw new Error('草稿儲存失敗，停止發布');
  }
  const prepared = ysbPrepareRichMenusInternal_();
  if (!prepared || !prepared.preparedMenus ||
      prepared.preparedMenus.length !== 2) {
    throw new Error('新版選單建立失敗，停止發布');
  }
  ysbPublishDefaultRichMenuInternal_();
  const state = ysbGetPublishState_();

  // 發布已成功。舊版清理若失敗不誤報發布失敗，保留待清理清單。
  let cleanup;
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      cleanup = ysbCleanupPublishedMenusInternal_();
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    cleanup = {deleted:[], failed:[], error:String(e.message || e)};
    Logger.log('新版已發布，但清理舊選單失敗：' + cleanup.error);
  }

  return {
    ok:true,
    message: cleanup.failed.length || cleanup.error
      ? '新版發布完成；部分舊版待清理'
      : 'LINE 圖文選單已更新，舊版清理完成',
    publishedAt:state.publishedAt,
    aboutMenuId:state.publishedMenus[0],
    memberMenuId:state.publishedMenus[1],
    cleanup:cleanup
  };
}

// ========================================
// 十、Gmail 一次性驗證碼及白名單授權
// 部署：以「我」執行，存取權限「任何人」；所有公開操作均須驗證 session。
// 注意：這是信箱持有權驗證，不是 Google OAuth 登入。
// ========================================
const YSB_USERS_KEY = 'YSB_AUTHORIZED_USERS_V1';
// Google 原生身分識別：部署必須「以存取網頁應用程式的使用者身分執行」。
// 禁止改成「以我身分執行」後仍沿用此授權流程。

function ysbNormalizeEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('請輸入有效的電子郵件地址');
  }
  return email;
}

function ysbDigest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
    .map(function(b) {return ('0' + (b & 255).toString(16)).slice(-2);}).join('');
}

function ysbCacheKey_(prefix, email) {
  return prefix + ysbDigest_(email);
}

function ysbOwnerEmail_() {
  const email = String(PropertiesService.getScriptProperties()
    .getProperty('YSB_OWNER_EMAIL') || '').trim().toLowerCase();
  if (!email) throw new Error('請先在指令碼屬性設定 YSB_OWNER_EMAIL');
  return email;
}

function ysbUserInfo_(email) {
  if (email === ysbOwnerEmail_()) return {email:email, role:'owner', version:0};
  const users = JSON.parse(PropertiesService.getScriptProperties()
    .getProperty(YSB_USERS_KEY) || '{}');
  const user = users[email];
  if (!user || !user.enabled) return null;
  return {email:email, role:'editor', version:Number(user.version || 0)};
}


// 僅限 YSB_OWNER_EMAIL。請務必將網頁部署的存取權限設為「僅限自己」。
function ysbRequireAuth_(unusedToken, ownerOnly) {
  const owner = ysbOwnerEmail_();
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) throw new Error('無法辨識登入帳號。請使用擁有者 Gmail，並將部署存取權限設為「僅限自己」。');
  if (email !== owner) throw new Error('此後台目前僅開放系統擁有者使用。');
  return {email:owner, role:'owner', version:0};
}

function ysbGetCurrentGoogleUser() {
  const user = ysbRequireAuth_();
  return {authorized:true, email:user.email, role:user.role};
}

function ysbListUsers(token) {
  ysbRequireAuth_(token, true);
  const users = JSON.parse(PropertiesService.getScriptProperties().getProperty(YSB_USERS_KEY) || '{}');
  return Object.keys(users).sort().map(function(email) {
    return {email:email, enabled:!!users[email].enabled};
  });
}

function ysbAddUser(email, token) {
  ysbRequireAuth_(token, true);
  throw new Error('目前為單人管理模式，已停用新增使用者功能。');
}

function ysbSetUserEnabled(email, enabled, token) {
  ysbRequireAuth_(token, true);
  throw new Error('目前為單人管理模式，已停用使用者權限管理功能。');
}

// 檢查所有 API 建立的 Rich Menu 與目前預設版本（不刪除）。
function ysbListAllRichMenus() {
  ysbRequireAuth_();
  const all = ysbLineRequest_('get', '/richmenu/list', undefined, false);
  const def = ysbLineRequest_('get', '/user/all/richmenu', undefined, false);
  const aliases = ysbLineRequest_('get', '/richmenu/alias/list', undefined, false);
  const report = {defaultRichMenuId:def.richMenuId,
    aliases:aliases.aliases || [], richmenus:all.richmenus || [],
    state:ysbGetPublishState_()};
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
