import './style.css';
import { createCampusScene } from './scene.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#campus-canvas');
const loading = $('#loading');
const labels = $('#labels');
const placeButtons = [...document.querySelectorAll('[data-place]')];
const viewButtons = [...document.querySelectorAll('[data-view]')];
const labelNodes = new Map();
let controller;
let selectedId = null;
let showLabels = true;
let autoRotate = false;
let failed = false;
let readyTimer;

const placeCopy = {
  'central-tower': { title: '中央高楼', kicker: '入口中轴的视觉中心', copy: '保留学校确认的尖顶，配合蓝灰玻璃、浅色竖向立面与中央回纹装饰。具体楼名与局部尺寸仍待核对。', tags: ['尖顶', '中央主楼'] },
  'left-side': { title: '食堂及住宿楼 · 共6层', kicker: '左前篮球场旁 · 临左侧马路', copy: '楼体位于左侧教学楼前方篮球场旁，并靠近左侧马路。共有6层，1—2楼为食堂，上方为住宿区。', tags: ['篮球场旁', '1—2楼食堂', '上方住宿区'] },
  'left-front': { title: '左侧教学楼 · 5层', kicker: '首层局部架空', copy: '首层局部留空，保留通道和承重柱。2—5层在靠中轴的内侧，通过开放扶手连廊与后排副楼相连。两排之间保留空地。', tags: ['5层', '首层架空', '内侧开放连廊'] },
  'right-front': { title: '右侧教学楼 · 5层', kicker: '首层局部架空', copy: '首层局部留空，保留通道和承重柱。2—5层在靠中轴的内侧，通过开放扶手连廊与后排副楼相连。两排之间保留空地。', tags: ['5层', '首层架空', '内侧开放连廊'] },
  track: { title: '250米环形跑道', kicker: '展开校园，让跑道抵达外沿', copy: '跑道按250米周长建模，并延伸到校园最外侧。弯道半径、直道比例和场地细节仍可继续校正。', tags: ['250米', '校园外沿'] },
  grandstand: { title: '主席台', kicker: '跑道靠教学楼一侧', copy: '按照学校补充，在跑道靠教学楼的一侧设置主席台，朝向运动场。台阶、平台和浅色雨棚参考校区照片，具体尺寸仍可继续校正。', tags: ['面向运动场', '教学楼一侧'] },
  'left-rear': { title: '左后副楼 · 7层', kicker: '四栋教学楼中的后排左楼', copy: '7层副楼与中央高楼连接，2—5层另有开放连廊通往前排教学楼。花园和凉亭位于这栋副楼后方。', tags: ['7层', '连接中央高楼', '楼后花园'] },
  'right-rear': { title: '右后副楼 · 7层', kicker: '四栋教学楼中的后排右楼', copy: '7层副楼与中央高楼连接，2—5层另有开放连廊通往前排教学楼。篮球场位于这栋副楼后方。', tags: ['7层', '连接中央高楼', '楼后篮球场'] },
  'basketball-rear': { title: '副楼后半场篮球场', kicker: '右后7层副楼后方', copy: '7层副楼后方为半场篮球场，只有一个篮架。前后两排教学楼之间保留空地。', tags: ['半场', '一个篮架', '7层楼后方'] },
  garden: { title: '花园与凉亭', kicker: '左后7层副楼后方', copy: '花园与凉亭位于左后7层副楼的后方。两排教学楼之间保留空地，花园不占用这处空地。', tags: ['副楼后花园', '凉亭'] },
};

function updateDetail(info) {
  selectedId = info?.id || null;
  autoRotate = false;
  $('#orbit-button').setAttribute('aria-pressed', 'false');
  const detail = placeCopy[selectedId];
  for (const button of placeButtons) {
    const active = button.dataset.place === selectedId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const [id, button] of labelNodes) button.classList.toggle('active', id === selectedId);
  if (!detail) {
    $('#detail-title').textContent = '熟悉的校园，新的视角';
    $('#detail-kicker').textContent = '这一版，按学校说明校正';
    $('#detail-copy').textContent = '四栋教学楼前后分列，后排7层副楼连接中央高楼；2—5层有开放连廊。食宿楼临左前球场及马路，花园和后球场位于7层楼后。';
    $('#detail-tags').replaceChildren(...['可旋转','可缩放','可点选'].map((tag)=>{
      const span=document.createElement('span');span.textContent=tag;return span;
    }));
    return;
  }
  $('#detail-title').textContent = detail.title;
  $('#detail-kicker').textContent = detail.kicker;
  $('#detail-copy').textContent = detail.copy;
  $('#detail-tags').replaceChildren(...detail.tags.map((tag) => {
    const span = document.createElement('span'); span.textContent = tag; return span;
  }));
}

function updateLabels(items) {
  const visibleIds = new Set();
  for (const item of items) {
    visibleIds.add(item.id);
    let node = labelNodes.get(item.id);
    if (!node) {
      node = document.createElement('button');
      node.type = 'button'; node.className = 'landmark-label';
      node.textContent = placeCopy[item.id]?.title.replace(' · 共6层', '') || item.name;
      node.dataset.landmark = item.id;
      node.setAttribute('aria-label', `查看${node.textContent}`);
      node.addEventListener('click', () => controller?.setFocus(item.id));
      labelNodes.set(item.id, node); labels.append(node);
    }
    node.hidden = !showLabels || !item.visible || item.x < 22 || item.y < 60 || item.x > canvas.clientWidth - 22 || item.y > canvas.clientHeight - 90;
    node.style.transform = `translate(${item.x}px, ${item.y}px) translate(-50%, -100%)`;
    node.classList.toggle('active', selectedId === item.id);
  }
  for (const [id, node] of labelNodes) if (!visibleIds.has(id)) node.hidden = true;
}

function activateView(name) {
  autoRotate = false;
  $('#orbit-button').setAttribute('aria-pressed', 'false');
  controller?.setView(name);
  for (const button of viewButtons) {
    button.classList.toggle('active', button.dataset.view === name);
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  }
  $('#view-caption').textContent = { hero: '校园总览', top: '俯视布局', front: '正面视角', rear: '副楼后方空间', track: '250米跑道' }[name] || '校园总览';
}

function showError() {
  if (failed) return;
  failed = true;
  clearTimeout(readyTimer);
  loading.hidden = true;
  $('#fallback').hidden = false;
  for (const button of [...placeButtons, ...viewButtons, $('#labels-button'), $('#orbit-button')]) button.disabled = true;
  document.documentElement.dataset.sceneStatus = 'error';
}

for (const button of placeButtons) button.addEventListener('click', () => controller?.setFocus(button.dataset.place));
for (const button of viewButtons) button.addEventListener('click', () => activateView(button.dataset.view));
$('#labels-button').addEventListener('click', () => {
  showLabels = !showLabels;
  $('#labels-button').classList.toggle('is-on', showLabels);
  $('#labels-button').setAttribute('aria-pressed', String(showLabels));
  controller?.setLabels(showLabels);
  if (!showLabels) for (const node of labelNodes.values()) node.hidden = true;
});
$('#orbit-button').addEventListener('click', () => {
  autoRotate = !autoRotate;
  $('#orbit-button').setAttribute('aria-pressed', String(autoRotate));
  controller?.setAutoRotate(autoRotate);
});
$('#reset-button').addEventListener('click', () => {
  controller?.reset(); autoRotate = false;
  $('#orbit-button').setAttribute('aria-pressed', 'false');
  activateView('hero'); updateDetail(null);
});
$('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('#viewer').requestFullscreen();
  } catch { $('#fullscreen-button').hidden = true; }
});
if (!document.fullscreenEnabled) $('#fullscreen-button').hidden = true;
$('#retry-button').addEventListener('click', () => location.reload());
canvas.addEventListener('webglcontextlost', showError);
window.addEventListener('pagehide', () => controller?.dispose());
if (matchMedia('(pointer: coarse)').matches) $('#hint-text').textContent = '单指旋转 · 双指缩放 · 点按建筑';

async function start() {
  readyTimer = setTimeout(showError, 45000);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}campus.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error('校园资料未能载入');
    const config = await response.json();
    controller = await createCampusScene({
      canvas, config, onSelect: updateDetail, onLabelsChange: updateLabels,
      onReady: () => {
        clearTimeout(readyTimer); loading.classList.add('finished');
        setTimeout(() => { loading.hidden = true; }, 450);
        document.documentElement.dataset.sceneStatus = 'ready';
      }, onError: showError,
    });
    if (failed) controller.dispose();
    // Compact, read-only scene info helps check the published page too.
    window.campusViewer = { getStats: () => controller.getStats(), getLandmarks: () => controller.getLandmarks() };
  } catch (error) {
    console.error('校园显示未完成', error); showError();
  }
}

start();
