const http=require('http'),fs=require('fs'),p=require('path');
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json'};
http.createServer((q,s)=>{
  let f=decodeURIComponent(q.url.split('?')[0]);
  if(f==='/')f='/organizador-pokemon-tcg.html';
  const fp=p.join(__dirname,f);
  fs.readFile(fp,(e,d)=>{
    if(e){s.writeHead(404);s.end('404');return}
    s.writeHead(200,{'Content-Type':T[p.extname(fp)]||'application/octet-stream'});s.end(d);
  });
}).listen(8731,()=>console.log('listo en http://localhost:8731'));
