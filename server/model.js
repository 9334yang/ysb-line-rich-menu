export const YSB_TABS = ['about', 'member'];
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


export { initialMenus_ as initialMenus, normalizeMenus_ as normalizeMenus, ysbBuildRichMenu_ as buildRichMenu };
