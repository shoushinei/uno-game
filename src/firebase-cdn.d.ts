// Firebase SDK を CDN の URL から直接 import しているため、
// TypeScript が型を解決できるようにアンビエント宣言で any 扱いにする。
declare module 'https://www.gstatic.com/firebasejs/*';