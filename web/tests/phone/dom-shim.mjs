// Enough of a document for react-dom/client to mount and click one button. Not a browser.
const listenersOf = new WeakMap();

function listen(node, type, fn) {
  const map = listenersOf.get(node) ?? new Map();
  const list = map.get(type) ?? [];
  list.push(fn);
  map.set(type, list);
  listenersOf.set(node, map);
}
function fire(node, event) {
  event.target ??= node;
  const chain = [];
  let current = node;
  while (current) { chain.push(current); current = current.parentNode; }
  for (const target of chain) for (const fn of [...(listenersOf.get(target)?.get(event.type) ?? [])]) fn.call(target, event);
  return true;
}
function link(parent) {
  let previous = null;
  for (const child of parent.childNodes) {
    child.parentNode = parent;
    child.previousSibling = previous;
    if (previous) previous.nextSibling = child;
    previous = child;
  }
  if (previous) previous.nextSibling = null;
  parent.firstChild = parent.childNodes[0] ?? null;
  parent.lastChild = parent.childNodes.at(-1) ?? null;
}
function element(tag, document) {
  const attrs = new Map();
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), ownerDocument: document,
    childNodes: [], children: [], parentNode: null, nextSibling: null, previousSibling: null,
    firstChild: null, lastChild: null, style: {}, namespaceURI: 'http://www.w3.org/1999/xhtml', className: '',
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    removeAttribute(name) { attrs.delete(name); },
    hasAttribute(name) { return attrs.has(name); },
    addEventListener(type, fn) { listen(node, type, fn); },
    removeEventListener() {},
    dispatchEvent(event) { return fire(node, event); },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      node.childNodes.push(child);
      if (child.nodeType === 1) node.children.push(child);
      link(node);
      return child;
    },
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const index = before ? node.childNodes.indexOf(before) : node.childNodes.length;
      node.childNodes.splice(index < 0 ? node.childNodes.length : index, 0, child);
      if (child.nodeType === 1) node.children.push(child);
      link(node);
      return child;
    },
    removeChild(child) {
      const index = node.childNodes.indexOf(child);
      if (index >= 0) node.childNodes.splice(index, 1);
      const childIndex = node.children.indexOf(child);
      if (childIndex >= 0) node.children.splice(childIndex, 1);
      child.parentNode = null;
      link(node);
      return child;
    },
    contains(other) { let current = other; while (current) { if (current === node) return true; current = current.parentNode; } return false; },
    focus() {}, blur() {},
    remove() { node.parentNode?.removeChild(node); },
    click() {
      node.dispatchEvent({ type: 'click', bubbles: true, cancelable: true, button: 0, defaultPrevented: false,
        timeStamp: Date.now(), preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
    },
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node.childNodes.map(child => child.textContent).join(''); },
    set(value) {
      node.childNodes = [];
      node.children = [];
      if (value) node.appendChild(document.createTextNode(String(value)));
    },
  });
  return node;
}
function text(data, document) {
  const node = { nodeType: 3, nodeName: '#text', data, ownerDocument: document, parentNode: null, childNodes: [], nextSibling: null, previousSibling: null };
  Object.defineProperty(node, 'textContent', { get() { return node.data; }, set(value) { node.data = String(value); } });
  return node;
}

export function installDom() {
  if (globalThis.document?.createElement) return;
  const document = {
    nodeType: 9, nodeName: '#document', parentNode: null, childNodes: [], activeElement: null,
    addEventListener(type, fn) { listen(document, type, fn); },
    removeEventListener() {},
    createElement(tag) { return element(tag, document); },
    createElementNS(_namespace, tag) { return document.createElement(tag); },
    createTextNode(data) { return text(data, document); },
    createComment() { return document.createTextNode(''); },
  };
  document.documentElement = document.createElement('html');
  document.head = document.createElement('head');
  document.body = document.createElement('body');
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  document.activeElement = document.body;
  const window = {
    document,
    HTMLElement: class HTMLElement {},
    HTMLIFrameElement: class HTMLIFrameElement {},
    Element: class Element {},
    Node: class Node {},
    addEventListener() {}, removeEventListener() {},
    getSelection: () => null,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  };
  document.defaultView = window;
  globalThis.window = window;
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLIFrameElement = window.HTMLIFrameElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}
