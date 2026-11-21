import{readFileSync,mkdirSync,writeFileSync}from'node:fs'
const E=process.env,I=E.MAKEFUN_INPUT_DIR||'/input',O=E.MAKEFUN_OUTPUT_DIR||'/output'
function S(t){
let w=t.indexOf('\n'),N=t.length,A=new Uint8Array(N),g=[],b=[],p=0,i=0
for(let ch of t){if(ch=='\n')continue;A[i]=ch=='#';if('.*+'.includes(ch))g.push(i);if(ch=='$'||ch=='*')b.push(i);if('@+'.includes(ch))p=i;i++}
let D=[-w,w,-1,1],L='udlr',V=new Uint8Array(N),q=g.slice()
for(let j=0;j<q.length;j++){let x=q[j];V[x]=1;for(let d of D){let y=x-d;if(!A[y]&&!A[y-d]&&!V[y]){V[y]=1;q.push(y)}}}
let R=p/w|0,C=new Int32Array(N),o=[]
for(let x of b)if(!C[x]){let f=[x],e2={b:[],g:[]};C[x]=o.length+1;for(let j=0;j<f.length;j++){let n=f[j];if(b.includes(n))e2.b.push(n);if(g.includes(n))e2.g.push(n);for(let k=0;k<4;k++){let m=n+D[k];if(!A[m]&&(m/w|0)!=R&&!C[m]){C[m]=o.length+1;f.push(m)}}}o.push(e2)}
function F(bs,P){
let B=[{b:bs.slice(),j:-1,u:P}],X=new Map,Y=new Int32Array(N),s=9,Ps=[]
function e(f,O,A2,r){s++;let l=f,H2=[f];A2[f]=s;if(r)Ps[f]='';while(H2.length){let p=H2.pop();if(p<l)l=p;for(let k=0;k<4;k++){let m=p+D[k];if(!A[m]&&!O.includes(m)&&A2[m]!=s){A2[m]=s;if(r)Ps[m]=Ps[p]+L[k];H2.push(m)}}}return l}
X.set(bs+';'+e(P,bs,Y,1),0)
let f=-1
for(let h2=0;h2<B.length&&f<0;h2++){
let a=B[h2].b
e(B[h2].u,a,Y,1)
let v=s
if(a.every(x=>g.includes(x))){f=h2;break}
for(let y of a)for(let k2=0;k2<4;k2++){let d=D[k2],t=y+d
if(Y[y-d]!=v||A[t]||a.includes(t)||!V[t])continue
let nb=a.slice();nb[nb.indexOf(y)]=t;nb.sort((x,z)=>x-z)
let m2=nb+';'+e(y,nb,C,0)
if(X.has(m2)||B.length>=25e4)continue
X.set(m2,B.length);B.push({b:nb,j:h2,u:y,s:Ps[y-d]+L[k2]})
}
}
if(f<0)return 0
let m=''
for(let s2=f;s2>0;s2=B[s2].j)m=B[s2].s+m
return[m,B[f].u]
}
let m='',p3=p
for(let r2 of o){
for(let o2 of o)if(o2!=r2)for(let x of o2.b)A[x]=1
let R2=F(r2.b,p3)
for(let o2 of o)if(o2!=r2)for(let x of o2.b)A[x]=0
if(!R2)return''
m+=R2[0];p3=R2[1];r2.b=r2.g
}
return m
}
for(let n=0;++n<6;){
mkdirSync(O+'/i00'+n,{recursive:true})
let m='';try{m=S(readFileSync(I+'/i00'+n+'/level.txt','utf8'))}catch{}
writeFileSync(O+'/i00'+n+'/solution.txt',m)
}
