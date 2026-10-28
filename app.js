
(function(){
"use strict";
/* ---------- hằng số & tiện ích ---------- */
var SHIFTS={K1:{t:'06:00 – 14:00',n:'Ca sáng'},K2:{t:'14:00 – 22:00',n:'Ca chiều'},K3:{t:'22:00 – 06:00',n:'Ca đêm'}};
var KEYS=['K1','K2','K3'];
var WD=['CN','T2','T3','T4','T5','T6','T7'];
var WDF=['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
var HOURS=8;
function pad(n){return String(n).padStart(2,'0');}
function dk(ym,d){return ym+'-'+pad(d);}
function wdOfKey(k){return new Date(+k.slice(0,4),+k.slice(5,7)-1,+k.slice(8,10)).getDay();}
function dim(ym){return new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate();}
function addM(ym,n){var d=new Date(+ym.slice(0,4),+ym.slice(5,7)-1+n,1);return d.getFullYear()+'-'+pad(d.getMonth()+1);}
function fmtD(k){return k.slice(8,10)+'/'+k.slice(5,7)+'/'+k.slice(0,4);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function clone(o){return JSON.parse(JSON.stringify(o||{}));}
var now=new Date();
var TODAY=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
var ymNow=TODAY.slice(0,7);

/* ---------- trạng thái ---------- */
var S={staff:{},months:{},notes:{},swaps:{},approvals:{},leaves:{}};
var SB=null, TOKEN='', ME=null, SCREEN='boot', CANEDIT=false, viewAsStaff=false, pending=0, lastJson='', pollT=null;
var ym=ymNow, tab='lich', selDate=TODAY.slice(0,7)===ym?TODAY:ym+'-01', selStaff=null;
var draft={staff:null,leave:{staffId:'',from:'',to:'',note:''},swap:{from:'',date:TODAY,to:'',reason:''},hoDate:TODAY,note:{},noteDate:'',confirm:'',auth:{code:'',pin:'',pin2:'',name:'',emergency:'',err:''},pinOpen:false,pinForm:{old:'',nw:'',err:''}};
var me='';
var toastMsg='',toastT=null,scrolledFor='';

function can(){return CANEDIT&&!viewAsStaff;}
function toast(m){toastMsg=m;render();clearTimeout(toastT);toastT=setTimeout(function(){toastMsg='';render();},3200);}

/* ---------- lưu trữ (Supabase qua các hàm RPC, mọi quyền kiểm tra ở máy chủ) ---------- */
function api(fn,args){
  return SB.rpc(fn,Object.assign({p_token:TOKEN},args||{})).then(function(r){
    if(r.error)throw new Error(r.error.message||'Lỗi kết nối');
    var d=r.data;
    if(d&&d.ok===false){if(d.error==='expired'){logout(true);}throw new Error(d.error==='expired'?'Phiên đăng nhập đã hết hạn.':(d.error||'Lỗi'));}
    return d;
  });
}
function put(col,id,data){
  S[col][id]=data;render();pending++;
  return api('api_put',{p_col:col,p_id:id,p_data:data}).catch(function(e){toast('Không lưu được: '+e.message);}).then(function(){pending--;return refresh(false,true);});
}
function del(col,id){
  delete S[col][id];render();pending++;
  return api('api_del',{p_col:col,p_id:id}).catch(function(e){toast('Không xóa được: '+e.message);}).then(function(){pending--;return refresh(false,true);});
}
function applyData(d){
  var docs=d.docs||{};
  ['staff','leaves','months','notes','swaps','approvals'].forEach(function(c){S[c]=docs[c]||{};});
  ME={id:d.me.id,is_head:!!d.me.is_head,name:(S.staff[d.me.id]||{}).name||''};
  me=ME.id;CANEDIT=ME.is_head;
  if(!CANEDIT)draft.swap.from=ME.id;
}
function refresh(first,force){
  if(!TOKEN)return Promise.resolve(false);
  if(pending>0&&!first)return Promise.resolve(false);
  return api('api_get',{}).then(function(d){
    var j=JSON.stringify(d),firstTime=SCREEN!=='app';
    if(j!==lastJson||firstTime||force){lastJson=j;applyData(d);SCREEN='app';render();}
    return true;
  }).catch(function(){return false;});
}
function logout(silent){
  if(!silent&&TOKEN){api('api_logout',{}).catch(function(){});}
  TOKEN='';ME=null;CANEDIT=false;lastJson='';viewAsStaff=false;
  S={staff:{},months:{},notes:{},swaps:{},approvals:{},leaves:{}};
  try{localStorage.removeItem('vh-token');}catch(e){}
  SCREEN='login';render();
}
function newId(p){return p+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36);}

/* ---------- dữ liệu dẫn xuất ---------- */
function staffList(){
  return Object.keys(S.staff).map(function(id){var s=S.staff[id];return Object.assign({id:id},s);}).sort(function(a,b){
    return ((a.role==='head'?0:1)-(b.role==='head'?0:1))||String(a.code||'').localeCompare(String(b.code||''),'vi',{numeric:true});
  });
}
function activeStaff(){return staffList().filter(function(s){return s.active!==false;});}
function nameOf(id){return S.staff[id]?S.staff[id].name:'(đã xóa)';}
function onLeave(id,k){
  for(var i in S.leaves){var l=S.leaves[i];if(l.staffId===id&&l.from<=k&&k<=l.to)return true;}
  return false;
}
function isOffDay(s,k){return typeof s.offDay==='number'&&s.offDay>=0&&s.offDay===wdOfKey(k);}
function shiftOf(id,k){var m=S.months[k.slice(0,7)];return m&&m.assign&&m.assign[k]?m.assign[k][id]||'':'';}
function statusOf(id,k){
  var s=S.staff[id];if(!s)return '';
  if(onLeave(id,k))return 'L';
  if(isOffDay(s,k))return 'P';
  return shiftOf(id,k);
}

/* ---------- thuật toán xếp ca ---------- */
function generate(month,fromDay){
  var act=activeStaff(),N=dim(month);
  var old=(S.months[month]&&S.months[month].assign)||{};
  var assign={},cnt={},idx={};
  act.forEach(function(s,i){cnt[s.id]={K1:0,K2:0,K3:0};idx[s.id]=i;});
  var d,k,id;
  for(d=1;d<fromDay;d++){k=dk(month,d);if(old[k]){assign[k]=old[k];for(id in old[k]){if(cnt[id])cnt[id][old[k][id]]++;}}}
  var y3={};
  var pk=fromDay>1?dk(month,fromDay-1):dk(addM(month,-1),dim(addM(month,-1)));
  var pa=fromDay>1?assign[pk]:(S.months[addM(month,-1)]&&S.months[addM(month,-1)].assign&&S.months[addM(month,-1)].assign[pk]);
  if(pa){for(id in pa){if(pa[id]==='K3')y3[id]=1;}}
  var order=['K3','K1','K2'];
  for(d=fromDay;d<=N;d++){
    k=dk(month,d);
    var av=act.filter(function(s){return !onLeave(s.id,k)&&!isOffDay(s,k);});
    var n=av.length,sz={K1:0,K2:0,K3:0},i;
    for(i=0;i<n;i++)sz[order[(i+d)%3]]++;
    var pool=av.slice(),res={};
    var tie=function(s){return ((idx[s.id]+d)%Math.max(act.length,1))/100;};
    var take=function(key,count,fn){
      pool.sort(function(a,b){return (fn(a)+tie(a))-(fn(b)+tie(b));});
      pool.splice(0,count).forEach(function(s){res[s.id]=key;cnt[s.id][key]++;});
    };
    take('K3',sz.K3,function(s){return cnt[s.id].K3*100+(y3[s.id]?30:0);});
    take('K2',sz.K2,function(s){return (y3[s.id]?-1000:0)+(cnt[s.id].K2-cnt[s.id].K1)*10;});
    pool.forEach(function(s){res[s.id]='K1';cnt[s.id].K1++;});
    assign[k]=res;
    y3={};for(id in res){if(res[id]==='K3')y3[id]=1;}
  }
  return assign;
}
function coverage(month){
  var m=S.months[month];if(!m||!m.assign)return [];
  var out=[];
  for(var d=1;d<=dim(month);d++){
    var k=dk(month,d),c={K1:0,K2:0,K3:0};
    activeStaff().forEach(function(s){var st=statusOf(s.id,k);if(c[st]!==undefined)c[st]++;});
    KEYS.forEach(function(x){if(c[x]===0)out.push(fmtD(k).slice(0,5)+' thiếu '+x);});
  }
  return out;
}
function summaryRows(month){
  var N=dim(month);
  return activeStaff().map(function(s){
    var r={s:s,P:0,L:0,K1:0,K2:0,K3:0,none:0};
    for(var d=1;d<=N;d++){
      var st=statusOf(s.id,dk(month,d));
      if(st==='P')r.P++;else if(st==='L')r.L++;else if(st)r[st]++;else r.none++;
    }
    r.work=r.K1+r.K2+r.K3;r.hours=r.work*HOURS;
    return r;
  });
}

/* ---------- giao diện ---------- */
var app=document.getElementById('app');
function sw(st){
  if(st==='K1'||st==='K2'||st==='K3')return '<span class="sw s-'+st+'">'+st+'</span>';
  if(st==='P')return '<span class="sw s-P" title="Nghỉ phiên">P</span>';
  if(st==='L')return '<span class="sw s-L" title="Nghỉ phép">L</span>';
  return '<span class="sw s-N">–</span>';
}
function legend(){
  return '<div class="legend">'+KEYS.map(function(k){return '<span class="lg">'+sw(k)+SHIFTS[k].n+' '+SHIFTS[k].t+'</span>';}).join('')+
  '<span class="lg">'+sw('P')+'Nghỉ phiên</span><span class="lg">'+sw('L')+'Nghỉ phép</span></div>';
}
function header(){
  var h='<div class="top"><div class="brand"><span class="eyebrow">Bảo Vệ Việt Hưng · 3 ca · 8 giờ/ca</span><h1>Lịch trực</h1></div><div class="ctl">';
  h+='<div class="monthnav"><button data-act="mprev" aria-label="Tháng trước">‹</button><span class="m">Tháng '+ym.slice(5,7)+' / '+ym.slice(0,4)+'</span><button data-act="mnext" aria-label="Tháng sau">›</button></div>';
  h+='<span class="chip '+(ME.is_head?'head':'')+'">'+esc(ME.name||'Tôi')+' · '+(ME.is_head?(viewAsStaff?'Trưởng ban (đang xem như nhân viên)':'Trưởng ban'):'Nhân viên')+'</span>';
  if(ME.is_head)h+='<button class="btn sm" data-act="togview">'+(viewAsStaff?'Quay lại quyền trưởng ban':'Xem như nhân viên')+'</button>';
  h+='<button class="btn sm" data-act="pinopen">Đổi PIN</button><button class="btn sm" data-act="logout">Đăng xuất</button>';
  h+='</div></div>';
  if(draft.pinOpen){
    var p=draft.pinForm;
    h+='<div class="card stack"><h3>Đổi mã PIN</h3><div class="grid"><label class="f">PIN hiện tại<input type="password" id="f_pinForm_old" data-bind="pinForm.old" data-enter="changepin" autocomplete="current-password"></label>'+
    '<label class="f">PIN mới (ít nhất 6 ký tự)<input type="password" id="f_pinForm_nw" data-bind="pinForm.nw" data-enter="changepin" autocomplete="new-password"></label></div>'+
    (p.err?'<span class="err">'+esc(p.err)+'</span>':'')+'<div class="row"><button class="btn pri" data-act="changepin">Lưu PIN mới</button><button class="btn" data-act="pinopen">Đóng</button></div></div>';
  }
  var pend=Object.keys(S.swaps).filter(function(i){return !S.approvals[i];}).length;
  var tabs=[['lich','Lịch trực'],['giaoban','Giao ban'],['doica','Đổi ca'+(pend?'<span class="bd">'+pend+'</span>':'')],['nhansu','Nhân sự'],['nghi','Nghỉ phép'],['tonghop','Tổng hợp']];
  h+='<div class="tabs" role="tablist">'+tabs.map(function(t){return '<button role="tab" aria-selected="'+(tab===t[0])+'" data-act="tab" data-arg="'+t[0]+'">'+t[1]+'</button>';}).join('')+'</div>';
  return h;
}

function screenAuth(){
  var a=draft.auth,setup=SCREEN==='setup';
  var h='<div class="auth card stack"><span class="eyebrow">Bảo Vệ Việt Hưng</span><h1>'+(setup?'Thiết lập lần đầu':'Lịch trực')+'</h1>';
  if(setup){
    h+='<p class="muted" style="margin:0">Chưa có tài khoản nào. Tạo tài khoản trưởng ban để bắt đầu. Sau đó bạn thêm nhân viên và đưa mã số, PIN cho từng người.</p>'+
    '<label class="f">Họ tên trưởng ban<input type="text" id="f_auth_name" data-bind="auth.name" data-enter="setup" autocomplete="name"></label>'+
    '<label class="f">Mã số<input type="text" id="f_auth_code" data-bind="auth.code" data-enter="setup" autocapitalize="characters" autocomplete="username"></label>'+
    '<label class="f">SĐT khẩn cấp<input type="tel" id="f_auth_emergency" data-bind="auth.emergency" data-enter="setup" inputmode="tel"></label>'+
    '<label class="f">PIN (ít nhất 6 ký tự)<input type="password" id="f_auth_pin" data-bind="auth.pin" data-enter="setup" autocomplete="new-password"></label>'+
    '<label class="f">Nhập lại PIN<input type="password" id="f_auth_pin2" data-bind="auth.pin2" data-enter="setup" autocomplete="new-password"></label>';
  }else{
    h+='<p class="muted" style="margin:0">Đăng nhập bằng mã số và PIN do trưởng ban cấp.</p>'+
    '<label class="f">Mã số<input type="text" id="f_auth_code" data-bind="auth.code" data-enter="login" autocapitalize="characters" autocomplete="username"></label>'+
    '<label class="f">PIN<input type="password" id="f_auth_pin" data-bind="auth.pin" data-enter="login" autocomplete="current-password"></label>';
  }
  if(a.err)h+='<span class="err">'+esc(a.err)+'</span>';
  h+='<button class="btn pri" data-act="'+(setup?'setup':'login')+'">'+(setup?'Tạo tài khoản trưởng ban':'Đăng nhập')+'</button>'+
  '<span class="pwa-note">Mẹo: trên điện thoại, dùng menu trình duyệt chọn “Thêm vào Màn hình chính” để mở như một ứng dụng.</span></div>';
  return h;
}
function screenNoCfg(){
  return '<div class="auth card stack"><h1>Chưa cấu hình</h1><p class="muted" style="margin:0">Mở tệp <b>config.js</b> và điền SUPABASE_URL cùng SUPABASE_ANON_KEY của dự án Supabase. Xem README.md để biết từng bước.</p></div>';
}

function tabLich(){
  var list=activeStaff(),m=S.months[ym],h='';
  if(!list.length){
    return '<div class="card empty"><h2>Chưa có nhân viên</h2><p class="muted" style="margin:0">Thêm nhân sự trước, sau đó tạo lịch tháng. Số người có thể thêm bớt bất kỳ lúc nào.</p>'+
      (can()?'<div class="row"><button class="btn pri" data-act="newstaff">Thêm nhân viên</button></div>':'<p class="hint">Chỉ trưởng ban thêm được nhân viên.</p>')+'</div>';
  }
  var nxt=addM(ymNow,1);
  h+='<div class="row sp">'+legend()+'<div class="row">';
  if(can()){
    h+='<button class="btn pri" data-act="gen">'+(m?'Tạo lại cả tháng':'Tạo lịch tháng '+ym.slice(5,7))+'</button>';
    if(m){
      var def=ym===ymNow?+TODAY.slice(8,10):1;
      if(draft.fromDay==null)draft.fromDay=def;
      h+='<label class="f" style="flex-direction:row;align-items:center;gap:6px">Xếp lại từ ngày<input type="number" id="f_fromDay" data-bind="fromDay" min="1" max="'+dim(ym)+'" style="width:64px"></label><button class="btn" data-act="regen">Xếp lại</button>';
    }
  }
  h+='</div></div>';
  if(draft.confirm==='gen')h+='<div class="alert warn row sp"><span>Lịch tháng này đã có. Tạo lại sẽ ghi đè cả những ca đã đổi tay.</span><span class="row"><button class="btn sm danger" data-act="gen2">Ghi đè</button><button class="btn sm" data-act="cancel">Hủy</button></span></div>';
  if(!m){
    h+='<div class="card stack"><h3>Chưa có lịch tháng '+ym.slice(5,7)+'/'+ym.slice(0,4)+'</h3><p class="muted" style="margin:0">Lịch được tạo mỗi tháng một lần vào ngày mùng 1'+(ym===nxt?' (tháng này sẽ tạo vào 01/'+ym.slice(5,7)+')':'')+'. Nghỉ phiên và nghỉ phép đã nhập sẽ được tính tự động.</p></div>';
    return h;
  }
  var cov=coverage(ym);
  if(cov.length)h+='<div class="alert bad"><b>Có ca chưa đủ người:</b> '+esc(cov.slice(0,12).join(', '))+(cov.length>12?' … và '+(cov.length-12)+' ca khác':'')+'. Kiểm tra nghỉ phiên và nghỉ phép trùng ngày.</div>';
  var missing=list.filter(function(s){var any=false;for(var d=1;d<=dim(ym);d++)if(shiftOf(s.id,dk(ym,d))){any=true;break;}return !any;});
  if(missing.length)h+='<div class="alert info">Chưa có ca cho: '+esc(missing.map(function(s){return s.name;}).join(', '))+'. Dùng “Xếp lại từ ngày” để đưa vào lịch.</div>';
  h+=matrix(list)+dayPanel();
  return h;
}
function matrix(list){
  var N=dim(ym),d,k,h='<div class="mx-wrap" id="mxw"><table class="mx"><thead><tr><th class="sticky">Nhân viên</th>';
  for(d=1;d<=N;d++){
    k=dk(ym,d);var w=wdOfKey(k);
    h+='<th class="'+((w===0||w===6)?'we ':'')+(k===TODAY?'today ':'')+(k===selDate?'sel':'')+'" data-act="pickdate" data-arg="'+k+'"><span class="wd">'+WD[w]+'</span><span class="dn">'+d+'</span></th>';
  }
  h+='</tr></thead><tbody>';
  list.forEach(function(s){
    h+='<tr><th class="sticky"><span class="nm">'+esc(s.name)+'</span><span class="cd">'+esc(s.code||'')+(s.role==='head'?' · Trưởng ban':'')+'</span></th>';
    for(d=1;d<=N;d++){
      k=dk(ym,d);var st=statusOf(s.id,k);
      var cls=(st?'s-'+st:'s-N')+(k===TODAY?' todaycol':'')+(k===selDate&&selStaff===s.id?' sel':'');
      h+='<td class="c '+cls+'" data-act="pickcell" data-arg="'+k+'|'+s.id+'" title="'+esc(s.name)+' · '+fmtD(k)+'">'+(st||'·')+'</td>';
    }
    h+='</tr>';
  });
  KEYS.forEach(function(x){
    h+='<tr class="cnt"><th class="sticky">Quân số '+x+'</th>';
    for(d=1;d<=N;d++){
      k=dk(ym,d);var c=0;list.forEach(function(s){if(statusOf(s.id,k)===x)c++;});
      h+='<td class="'+(c===0?'z':'')+'">'+c+'</td>';
    }
    h+='</tr>';
  });
  return h+'</tbody></table></div>';
}
function rosterFor(k,x){return activeStaff().filter(function(s){return statusOf(s.id,k)===x;});}
function dayPanel(){
  var k=selDate;if(!k||k.slice(0,7)!==ym)return '';
  var h='<div class="card stack"><div class="row sp"><h2>'+WDF[wdOfKey(k)]+', '+fmtD(k)+'</h2><button class="btn sm" data-act="gohoDate" data-arg="'+k+'">Mở giao ban ngày này</button></div><div class="cols3">';
  KEYS.forEach(function(x){
    var r=rosterFor(k,x),note=S.notes[k+'_'+x];
    h+='<div class="shiftcard"><header class="s-'+x+'"><b>'+x+'</b><span class="small">'+SHIFTS[x].t+'</span></header><div class="bd"><div class="names">'+
      (r.length?r.map(function(s){return '<span class="tag">'+esc(s.name)+'</span>';}).join(''):'<span class="err">Chưa có ai</span>')+'</div>'+
      (note&&note.text?'<div class="hint"><b>Giao ban:</b> '+esc(note.text.length>140?note.text.slice(0,140)+'…':note.text)+'</div>':'<div class="hint">Chưa có ghi chú giao ban.</div>')+'</div></div>';
  });
  h+='</div>';
  var off=activeStaff().filter(function(s){return statusOf(s.id,k)==='P';}),lv=activeStaff().filter(function(s){return statusOf(s.id,k)==='L';});
  h+='<div class="row small">'+sw('P')+'<span>'+(off.length?esc(off.map(function(s){return s.name;}).join(', ')):'không ai nghỉ phiên')+'</span>'+sw('L')+'<span>'+(lv.length?esc(lv.map(function(s){return s.name;}).join(', ')):'không ai nghỉ phép')+'</span></div>';
  if(can()&&selStaff&&S.staff[selStaff]){
    var cur=shiftOf(selStaff,k),st=statusOf(selStaff,k);
    h+='<div class="row" style="border-top:1px solid var(--line);padding-top:12px"><span class="hl">'+esc(nameOf(selStaff))+'</span>'+sw(st)+(st==='L'||st==='P'?'<span class="hint">Đang nghỉ, không đổi ca.</span>':
      '<span class="hint">Đặt ca:</span>'+KEYS.map(function(x){return '<button class="btn sm'+(cur===x?' pri':'')+'" data-act="setshift" data-arg="'+x+'">'+x+'</button>';}).join('')+'<button class="btn sm" data-act="setshift" data-arg="">Bỏ ca</button>')+'</div>';
  }else if(can())h+='<div class="hint">Chạm vào một ô trong bảng để chỉnh ca của người đó.</div>';
  return h+'</div>';
}

function tabGiaoBan(){
  var k=draft.hoDate||TODAY;
  if(draft.noteDate!==k){draft.noteDate=k;draft.note={};KEYS.forEach(function(x){var n=S.notes[k+'_'+x];draft.note[x]=n?n.text:'';});}
  var h='<div class="row sp"><div class="stack"><h2>Giao ban giữa các ca</h2><span class="hint">Ca trước ghi lại việc tồn đọng, ca sau đọc trước khi nhận trực. Ai cũng ghi được.</span></div>'+
    '<div class="row"><button class="btn sm" data-act="hoday" data-arg="-1">‹ Hôm trước</button><input type="date" id="f_hoDate" data-bind="hoDate" data-re="1" style="width:auto"><button class="btn sm" data-act="hoday" data-arg="1">Hôm sau ›</button></div></div>';
  h+='<div class="cols3">';
  KEYS.forEach(function(x,i){
    var r=rosterFor(k,x),n=S.notes[k+'_'+x];
    h+='<div class="shiftcard"><header class="s-'+x+'"><b>'+x+'</b><span class="small">'+SHIFTS[x].t+'</span></header><div class="bd">'+
      '<div class="names">'+(r.length?r.map(function(s){return '<span class="tag">'+esc(s.name)+'</span>';}).join(''):'<span class="hint">Chưa có lịch cho ngày này</span>')+'</div>'+
      '<label class="f">Nội dung giao ban '+x+'<textarea id="f_note_'+x+'" data-bind="note.'+x+'" placeholder="Tình hình, việc tồn đọng, lưu ý cho ca sau…"></textarea></label>'+
      '<div class="row sp"><span class="hint">'+(n?'Ghi bởi '+esc(n.by||'?')+' lúc '+new Date(n.at).toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):'Chưa lưu')+'</span><button class="btn sm pri" data-act="savenote" data-arg="'+x+'">Lưu</button></div></div></div>';
  });
  return h+'</div>';
}

function tabDoiCa(){
  var list=activeStaff(),sd=draft.swap,h='<div class="stack"><h2>Đổi ca</h2><span class="hint">Hai người đổi ca cho nhau trong cùng một ngày. Đổi ca chỉ có hiệu lực khi trưởng ban đồng ý. Bạn chỉ đề nghị đổi ca cho chính mình.</span></div>';
  var opt=function(v){return '<option value="">Chọn…</option>'+list.map(function(s){return '<option value="'+s.id+'">'+esc(s.name)+'</option>';}).join('');};
  var a=sd.from&&sd.date?statusOf(sd.from,sd.date):'',b=sd.to&&sd.date?statusOf(sd.to,sd.date):'';
  var info='';
  if(sd.from&&sd.to&&sd.date){
    if(sd.from===sd.to)info='<span class="err">Chọn hai người khác nhau.</span>';
    else if(!/^K/.test(a)||!/^K/.test(b))info='<span class="err">Cả hai phải đang có ca vào ngày này (hiện '+esc(nameOf(sd.from))+': '+(a||'chưa xếp')+', '+esc(nameOf(sd.to))+': '+(b||'chưa xếp')+').</span>';
    else if(a===b)info='<span class="err">Hai người đang cùng ca '+a+'.</span>';
    else info='<span class="hint">Sau khi đổi: '+esc(nameOf(sd.from))+' '+b+', '+esc(nameOf(sd.to))+' '+a+'.</span>';
  }
  h+='<div class="card stack"><div class="grid"><label class="f">Người đề nghị<select id="f_swap_from" data-bind="swap.from" data-re="1"'+(can()?'':' disabled')+'>'+opt()+'</select></label>'+
    '<label class="f">Ngày<input type="date" id="f_swap_date" data-bind="swap.date" data-re="1"></label>'+
    '<label class="f">Đổi với<select id="f_swap_to" data-bind="swap.to" data-re="1">'+opt()+'</select></label></div>'+
    '<label class="f">Lý do<input type="text" id="f_swap_reason" data-bind="swap.reason" placeholder="Việc gia đình, khám bệnh…"></label>'+
    '<div class="row sp"><div>'+info+'</div><button class="btn pri" data-act="sendswap">Gửi đề nghị</button></div></div>';
  var ids=Object.keys(S.swaps).sort(function(x,y){return (S.swaps[y].createdAt||0)-(S.swaps[x].createdAt||0);});
  h+='<h3>Đề nghị gần đây</h3>';
  if(!ids.length)h+='<div class="card muted">Chưa có đề nghị đổi ca nào.</div>';
  else{
    h+='<div class="stack">'+ids.slice(0,30).map(function(i){
      var w=S.swaps[i],ap=S.approvals[i];
      var st=ap?(ap.status==='approved'?'<span class="chip ok">Đã đồng ý</span>':'<span class="chip bad">Từ chối</span>'):'<span class="chip warn">Chờ trưởng ban</span>';
      return '<div class="card row sp"><div class="stack" style="gap:2px"><span><b>'+esc(nameOf(w.from))+'</b> ⇄ <b>'+esc(nameOf(w.to))+'</b> · '+fmtD(w.date)+' · '+w.fromShift+' ⇄ '+w.toShift+'</span>'+
        (w.reason?'<span class="hint">'+esc(w.reason)+'</span>':'')+'</div><div class="row">'+st+
        (!ap&&can()?'<button class="btn sm pri" data-act="decide" data-arg="'+i+'|1">Đồng ý</button><button class="btn sm danger" data-act="decide" data-arg="'+i+'|0">Từ chối</button>':'')+'</div></div>';
    }).join('')+'</div>';
  }
  return h;
}

function staffForm(){
  var f=draft.staff;if(!f)return '';
  var e=f.err||{};
  var h='<div class="card stack"><h3>'+(f.id?'Sửa nhân viên':'Thêm nhân viên')+'</h3><div class="grid">'+
  '<label class="f">Mã số'+(can()?'':' (chỉ trưởng ban sửa)')+'<input type="text" id="f_staff_code" data-bind="staff.code"'+(can()?'':' disabled')+'>'+(e.code?'<span class="err">'+e.code+'</span>':'')+'</label>'+
  '<label class="f">Họ tên<input type="text" id="f_staff_name" data-bind="staff.name">'+(e.name?'<span class="err">'+e.name+'</span>':'')+'</label>'+
  '<label class="f">Vai trò<select id="f_staff_role" data-bind="staff.role"><option value="staff">Nhân viên</option><option value="head">Trưởng ban</option></select></label>'+
  '<label class="f">Số điện thoại<input type="tel" id="f_staff_phone" data-bind="staff.phone" inputmode="tel"></label>'+
  '<label class="f">SĐT khẩn cấp (bắt buộc)<input type="tel" id="f_staff_emergency" data-bind="staff.emergency" inputmode="tel" placeholder="Người thân cần báo tin">'+(e.emergency?'<span class="err">'+e.emergency+'</span>':'')+'</label>'+
  (can()?'<label class="f">Mã PIN đăng nhập'+(f.id?' (để trống nếu không đổi)':' (ít nhất 6 ký tự)')+'<span class="row" style="flex-wrap:nowrap"><input type="text" id="f_staff_pin" data-bind="staff.pin" autocomplete="off"><button class="btn sm" type="button" data-act="genpin">Tạo ngẫu nhiên</button></span>'+(e.pin?'<span class="err">'+e.pin+'</span>':'')+'</label>':'')+
  '<label class="f">Ngày nghỉ phiên (cả ngày, hằng tuần)<select id="f_staff_offDay" data-bind="staff.offDay"><option value="-1">Không cố định</option>'+WDF.map(function(n,i){return '<option value="'+i+'">'+n+'</option>';}).join('')+'</select></label>'+
  '</div><label class="row" style="gap:8px"><input type="checkbox" id="f_staff_active" data-bind="staff.active"> Đang làm việc (bỏ chọn khi nghỉ hẳn, tên vẫn giữ trong lịch sử)</label>'+
  '<div class="row"><button class="btn pri" data-act="savestaff">Lưu</button><button class="btn" data-act="cancelstaff">Hủy</button></div></div>';
  return h;
}
function tabNhanSu(){
  var list=staffList(),h='<div class="row sp"><div class="stack"><h2>Nhân sự ('+list.filter(function(s){return s.active!==false;}).length+' đang làm)</h2><span class="hint">Mã số và hồ sơ do trưởng ban quản lý. Số nhân viên thêm bớt tự do, lịch sẽ xếp lại theo danh sách mới.</span></div>'+
  (can()?'<div class="row"><button class="btn pri" data-act="newstaff">Thêm nhân viên</button></div>':'')+'</div>';
  h+=staffForm();
  if(!list.length){
    return h+'<div class="card empty"><p class="muted" style="margin:0">Chưa có ai trong danh sách.</p>'+'</div>';
  }
  h+='<div class="tbl-wrap"><table class="tb"><thead><tr><th>Mã số</th><th>Họ tên</th><th>Vai trò</th><th>SĐT</th><th>SĐT khẩn cấp</th><th>Nghỉ phiên</th><th></th></tr></thead><tbody>';
  list.forEach(function(s){
    h+='<tr style="'+(s.active===false?'opacity:.55':'')+'"><td><b>'+esc(s.code||'')+'</b></td><td>'+esc(s.name)+(s.active===false?' <span class="chip">Đã nghỉ</span>':'')+'</td><td>'+(s.role==='head'?'<span class="chip head">Trưởng ban</span>':'Nhân viên')+'</td><td>'+esc(s.phone||'–')+'</td><td>'+(s.emergency?esc(s.emergency):'<span class="chip bad">Thiếu</span>')+'</td><td>'+(typeof s.offDay==='number'&&s.offDay>=0?WDF[s.offDay]:'–')+'</td><td>'+
      (can()?(draft.confirm==='del:'+s.id?'<button class="btn sm danger" data-act="delstaff2" data-arg="'+s.id+'">Xóa hẳn</button> <button class="btn sm" data-act="cancel">Hủy</button>':'<button class="btn sm" data-act="editstaff" data-arg="'+s.id+'">Sửa</button> <button class="btn sm danger" data-act="delstaff" data-arg="'+s.id+'">Xóa</button>'):'')+'</td></tr>';
  });
  h+='</tbody></table></div>';
  var byDay={};activeStaff().forEach(function(s){if(typeof s.offDay==='number'&&s.offDay>=0)(byDay[s.offDay]=byDay[s.offDay]||[]).push(s.name);});
  var crowded=Object.keys(byDay).filter(function(d){return byDay[d].length>3;});
  if(crowded.length)h+='<div class="alert warn">Nhiều người nghỉ phiên cùng '+crowded.map(function(d){return WDF[d];}).join(', ')+' (hơn 3 người). Nên dàn đều các ngày để đủ quân số.</div>';
  return h;
}

function tabNghi(){
  var lv=draft.leave,list=activeStaff();
  var h='<div class="stack"><h2>Nghỉ phép</h2><span class="hint">Nhân viên báo trước từng tháng; trưởng ban đánh dấu ngày bắt đầu và ngày kết thúc kỳ nghỉ. Lịch mới sẽ tự bỏ những ngày này.</span></div>';
  if(can()){
    h+='<div class="card stack"><div class="grid"><label class="f">Nhân viên<select id="f_leave_staffId" data-bind="leave.staffId"><option value="">Chọn…</option>'+list.map(function(s){return '<option value="'+s.id+'">'+esc(s.name)+'</option>';}).join('')+'</select></label>'+
    '<label class="f">Ngày bắt đầu<input type="date" id="f_leave_from" data-bind="leave.from"></label><label class="f">Ngày kết thúc<input type="date" id="f_leave_to" data-bind="leave.to"></label>'+
    '<label class="f">Ghi chú<input type="text" id="f_leave_note" data-bind="leave.note" placeholder="Phép năm, việc riêng…"></label></div>'+
    (lv.err?'<span class="err">'+lv.err+'</span>':'')+'<div class="row"><button class="btn pri" data-act="addleave">Đánh dấu nghỉ</button></div></div>';
  }
  var ids=Object.keys(S.leaves).sort(function(a,b){return S.leaves[b].from.localeCompare(S.leaves[a].from);});
  if(!ids.length)return h+'<div class="card muted">Chưa có kỳ nghỉ phép nào.</div>';
  h+='<div class="tbl-wrap"><table class="tb"><thead><tr><th>Nhân viên</th><th>Từ ngày</th><th>Đến ngày</th><th class="n">Số ngày</th><th>Ghi chú</th><th></th></tr></thead><tbody>';
  ids.forEach(function(i){
    var l=S.leaves[i],days=Math.round((new Date(l.to)-new Date(l.from))/864e5)+1;
    h+='<tr><td>'+esc(nameOf(l.staffId))+'</td><td>'+fmtD(l.from)+'</td><td>'+fmtD(l.to)+'</td><td class="n">'+days+'</td><td>'+esc(l.note||'')+'</td><td>'+(can()?'<button class="btn sm danger" data-act="delleave" data-arg="'+i+'">Xóa</button>':'')+'</td></tr>';
  });
  return h+'</tbody></table></div>';
}

function tabTongHop(){
  var m=S.months[ym],rows=summaryRows(ym);
  var h='<div class="row sp"><div class="stack"><h2>Tổng hợp tháng '+ym.slice(5,7)+'/'+ym.slice(0,4)+'</h2><span class="hint">Mỗi ca tính '+HOURS+' giờ. Nghỉ phiên là ngày nghỉ cố định hằng tuần; nghỉ phép theo kỳ trưởng ban đã đánh dấu.</span></div><button class="btn" data-act="csv">Tải CSV</button></div>';
  if(!rows.length)return h+'<div class="card muted">Chưa có nhân viên.</div>';
  if(!m)h+='<div class="alert info">Chưa có lịch tháng này, số liệu ca sẽ là 0 đến khi trưởng ban tạo lịch.</div>';
  var tot={P:0,L:0,K1:0,K2:0,K3:0,hours:0,work:0};
  h+='<div class="tbl-wrap"><table class="tb"><thead><tr><th>Mã số</th><th>Họ tên</th><th class="n">Nghỉ phiên (ngày)</th><th class="n">Nghỉ phép (ngày)</th><th class="n">Ngày làm</th><th class="n">K1 (giờ)</th><th class="n">K2 (giờ)</th><th class="n">K3 (giờ)</th><th class="n">Tổng giờ</th></tr></thead><tbody>';
  rows.forEach(function(r){
    KEYS.concat(['P','L','hours','work']).forEach(function(x){tot[x]+=r[x];});
    h+='<tr><td><b>'+esc(r.s.code||'')+'</b></td><td>'+esc(r.s.name)+'</td><td class="n">'+r.P+'</td><td class="n">'+r.L+'</td><td class="n">'+r.work+'</td><td class="n">'+r.K1*HOURS+'</td><td class="n">'+r.K2*HOURS+'</td><td class="n">'+(r.K3?r.K3*HOURS:(m?'<span class="chip bad">0</span>':'0'))+'</td><td class="n"><b>'+r.hours+'</b></td></tr>';
  });
  h+='</tbody><tfoot><tr><td></td><td>Cả tổ</td><td class="n">'+tot.P+'</td><td class="n">'+tot.L+'</td><td class="n">'+tot.work+'</td><td class="n">'+tot.K1*HOURS+'</td><td class="n">'+tot.K2*HOURS+'</td><td class="n">'+tot.K3*HOURS+'</td><td class="n">'+tot.hours+'</td></tr></tfoot></table></div>';
  if(m){
    var min=Math.min.apply(null,rows.map(function(r){return r.K3;})),max=Math.max.apply(null,rows.map(function(r){return r.K3;}));
    h+='<div class="alert '+(min>=1&&max-min<=2?'info':'warn')+'">Số ca K3 mỗi người: ít nhất '+min+', nhiều nhất '+max+'. '+(min>=1?'Ai cũng đã có ca K3.':'Có người chưa trực ca K3, hãy xếp lại.')+'</div>';
  }
  return h;
}

function render(){
  var ae=document.activeElement,fid=ae&&app.contains(ae)?ae.id:'',ss=null,se=null;
  try{if(fid&&ae.selectionStart!=null){ss=ae.selectionStart;se=ae.selectionEnd;}}catch(e){}
  var ox=window.scrollX,oy=window.scrollY,mw=document.getElementById('mxw'),sl=mw?mw.scrollLeft:null;
  var html;
  if(SCREEN==='nocfg')html=screenNoCfg();
  else if(SCREEN==='login'||SCREEN==='setup')html=screenAuth();
  else if(SCREEN!=='app'||!ME)html='<div class="card muted">Đang tải…</div>';
  else html=header()+'<div class="stack">'+{lich:tabLich,giaoban:tabGiaoBan,doica:tabDoiCa,nhansu:tabNhanSu,nghi:tabNghi,tonghop:tabTongHop}[tab]()+'</div>';
  app.innerHTML=html+(toastMsg?'<div class="toast" role="status">'+esc(toastMsg)+'</div>':'');
  app.querySelectorAll('[data-bind]').forEach(function(el){
    var v=getDraft(el.dataset.bind);
    if(el.type==='checkbox')el.checked=!!v;else el.value=(v==null?'':v);
  });
  var mw2=document.getElementById('mxw');
  if(mw2){
    if(scrolledFor!==ym&&ym===ymNow){var c=mw2.querySelector('th.today');if(c)mw2.scrollLeft=Math.max(0,c.offsetLeft-mw2.clientWidth/2);scrolledFor=ym;}
    else if(sl!=null)mw2.scrollLeft=sl;
  }
  window.scrollTo(ox,oy);
  if(fid){var el=document.getElementById(fid);if(el){el.focus({preventScroll:true});try{if(ss!=null&&el.setSelectionRange)el.setSelectionRange(ss,se);}catch(e){}}}
}

/* ---------- bản nháp biểu mẫu ---------- */
function getDraft(path){var p=path.split('.'),o=draft;for(var i=0;i<p.length;i++){if(o==null)return '';o=o[p[i]];}return o;}
function setDraft(path,v){var p=path.split('.'),o=draft;for(var i=0;i<p.length-1;i++){if(o[p[i]]==null)o[p[i]]={};o=o[p[i]];}o[p[p.length-1]]=v;}

/* ---------- hành động ---------- */
function validPhone(v){return /^[0-9+\s().-]{8,16}$/.test(String(v||'').trim());}
var ACT={
  tab:function(a){tab=a;draft.confirm='';render();},
  mprev:function(){ym=addM(ym,-1);selDate=ym===ymNow?TODAY:ym+'-01';draft.fromDay=null;draft.confirm='';render();},
  mnext:function(){ym=addM(ym,1);selDate=ym===ymNow?TODAY:ym+'-01';draft.fromDay=null;draft.confirm='';render();},
  logout:function(){logout(false);},
  pinopen:function(){draft.pinOpen=!draft.pinOpen;draft.pinForm={old:'',nw:'',err:''};render();},
  changepin:function(){
    var f=draft.pinForm;
    if(!f.old||String(f.nw||'').length<6){f.err='Nhập PIN hiện tại và PIN mới (ít nhất 6 ký tự).';render();return;}
    api('api_change_pin',{p_old:f.old,p_new:f.nw}).then(function(d){draft.pinOpen=false;draft.pinForm={old:'',nw:'',err:''};toast('Đã đổi PIN.');}).catch(function(e){f.err=e.message;render();});
  },
  login:function(){
    var a=draft.auth;
    if(!a.code.trim()||!a.pin){a.err='Nhập mã số và PIN.';render();return;}
    SB.rpc('login',{p_code:a.code.trim(),p_pin:a.pin}).then(function(r){
      if(r.error||!r.data||!r.data.ok){a.err=(r.data&&r.data.error)||'Không đăng nhập được. Kiểm tra kết nối mạng.';a.pin='';render();return;}
      TOKEN=r.data.token;try{localStorage.setItem('vh-token',TOKEN);}catch(e){}
      a.pin='';a.err='';lastJson='';refresh(true);
    });
  },
  setup:function(){
    var a=draft.auth;
    if(!a.name.trim()||!a.code.trim()){a.err='Nhập họ tên và mã số.';render();return;}
    if(!validPhone(a.emergency)){a.err='Nhập SĐT khẩn cấp hợp lệ (8–16 số).';render();return;}
    if(String(a.pin||'').length<6){a.err='PIN cần ít nhất 6 ký tự.';render();return;}
    if(a.pin!==a.pin2){a.err='Hai lần nhập PIN chưa khớp.';render();return;}
    SB.rpc('setup_head',{p_code:a.code.trim(),p_name:a.name.trim(),p_pin:a.pin,p_emergency:a.emergency.trim()}).then(function(r){
      if(r.error||!r.data||!r.data.ok){a.err=(r.data&&r.data.error)||'Không tạo được tài khoản.';render();return;}
      TOKEN=r.data.token;try{localStorage.setItem('vh-token',TOKEN);}catch(e){}
      a.pin=a.pin2='';a.err='';lastJson='';refresh(true);
    });
  },
  genpin:function(){draft.staff.pin=String(Math.floor(100000+Math.random()*900000));render();},
  togview:function(){viewAsStaff=!viewAsStaff;render();},
  cancel:function(){draft.confirm='';render();},
  pickdate:function(a){selDate=a;selStaff=null;render();},
  pickcell:function(a){var p=a.split('|');selDate=p[0];selStaff=p[1];render();},
  gen:function(){
    if(S.months[ym]){draft.confirm='gen';render();return;}
    ACT.gen2();
  },
  gen2:function(){
    draft.confirm='';
    if(!activeStaff().length){toast('Chưa có nhân viên.');return;}
    put('months',ym,{assign:generate(ym,1),generatedAt:Date.now()});
    toast('Đã tạo lịch tháng '+ym.slice(5,7)+'/'+ym.slice(0,4));
  },
  regen:function(){
    var f=Math.min(Math.max(parseInt(draft.fromDay,10)||1,1),dim(ym));
    put('months',ym,{assign:generate(ym,f),generatedAt:Date.now(),fromDay:f});
    toast('Đã xếp lại từ ngày '+f);
  },
  setshift:function(a){
    if(!can()||!selStaff||!selDate)return;
    var m=clone(S.months[ym]);m.assign=m.assign||{};m.assign[selDate]=m.assign[selDate]||{};
    if(a)m.assign[selDate][selStaff]=a;else delete m.assign[selDate][selStaff];
    put('months',ym,m);
  },
  gohoDate:function(a){draft.hoDate=a;draft.noteDate='';tab='giaoban';render();},
  hoday:function(a){var d=new Date(draft.hoDate||TODAY);d.setDate(d.getDate()+(+a));draft.hoDate=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());draft.noteDate='';render();},
  savenote:function(x){
    var k=draft.hoDate||TODAY,t=(draft.note[x]||'').trim();
    put('notes',k+'_'+x,{text:t,by:ME?ME.name:'',at:Date.now()});
    toast('Đã lưu giao ban '+x+' ngày '+fmtD(k).slice(0,5));
  },
  sendswap:function(){
    var s=draft.swap;
    if(!s.from||!s.to||!s.date){toast('Chọn người đề nghị, ngày và người đổi.');return;}
    if(s.from===s.to){toast('Chọn hai người khác nhau.');return;}
    var a=statusOf(s.from,s.date),b=statusOf(s.to,s.date);
    if(!/^K/.test(a)||!/^K/.test(b)||a===b){toast('Hai người cần có ca khác nhau trong ngày này.');return;}
    put('swaps',newId('w'),{from:s.from,to:s.to,date:s.date,fromShift:a,toShift:b,reason:s.reason||'',createdAt:Date.now()});
    draft.swap.reason='';toast('Đã gửi đề nghị, chờ trưởng ban.');
  },
  decide:function(a){
    var p=a.split('|'),id=p[0],ok=p[1]==='1',w=S.swaps[id];if(!w||!can())return;
    if(ok){
      var month=w.date.slice(0,7),m=clone(S.months[month]),x=m.assign&&m.assign[w.date];
      if(!x||!x[w.from]||!x[w.to]||x[w.from]===x[w.to]||onLeave(w.from,w.date)||onLeave(w.to,w.date)){toast('Ca hiện tại đã thay đổi nên không đổi được.');return;}
      var t=x[w.from];x[w.from]=x[w.to];x[w.to]=t;
      put('months',month,m);
    }
    put('approvals',id,{status:ok?'approved':'rejected',at:Date.now()});
    toast(ok?'Đã đồng ý và cập nhật lịch.':'Đã từ chối đề nghị.');
  },
  newstaff:function(){
    var n=staffList().length+1;
    draft.staff={id:null,code:'VH'+pad(n),name:'',role:'staff',phone:'',emergency:'',offDay:'-1',active:true,pin:'',err:{}};tab='nhansu';render();
  },
  editstaff:function(a){var s=S.staff[a];draft.staff={id:a,code:s.code||'',name:s.name||'',role:s.role||'staff',phone:s.phone||'',emergency:s.emergency||'',offDay:String(typeof s.offDay==='number'?s.offDay:-1),active:s.active!==false,pin:'',err:{}};render();},
  cancelstaff:function(){draft.staff=null;render();},
  savestaff:function(){
    var f=draft.staff,e={};
    if(!f.name.trim())e.name='Nhập họ tên.';
    if(!f.code.trim())e.code='Nhập mã số.';
    else if(Object.keys(S.staff).some(function(i){return i!==f.id&&String(S.staff[i].code).toLowerCase()===f.code.trim().toLowerCase();}))e.code='Mã số đã có người dùng.';
    if(!validPhone(f.emergency))e.emergency='Nhập số điện thoại khẩn cấp hợp lệ (8–16 số).';
    if(can()){if(!f.id&&String(f.pin||'').length<6)e.pin='Nhập PIN cho nhân viên mới (ít nhất 6 ký tự).';else if(f.pin&&String(f.pin).length<6)e.pin='PIN cần ít nhất 6 ký tự.';}
    f.err=e;
    if(Object.keys(e).length){render();return;}
    var id=f.id||newId('s'),old=S.staff[id]||{};
    var rec={code:can()?f.code.trim():(old.code||f.code.trim()),name:f.name.trim(),role:f.role,phone:f.phone.trim(),emergency:f.emergency.trim(),offDay:parseInt(f.offDay,10),active:!!f.active};
    var pin=f.pin||'';draft.staff=null;pending++;
    api('api_save_staff',{p_id:id,p_data:rec,p_pin:pin}).then(function(){S.staff[id]=rec;toast('Đã lưu '+rec.name+(pin?'. PIN: '+pin+' (hãy ghi lại)':''));}).catch(function(e){toast('Không lưu được: '+e.message);}).then(function(){pending--;return refresh(false,true);});
    render();
  },
  delstaff:function(a){draft.confirm='del:'+a;render();},
  delstaff2:function(a){draft.confirm='';pending++;api('api_delete_staff',{p_id:a}).then(function(){delete S.staff[a];toast('Đã xóa nhân viên.');}).catch(function(e){toast(e.message);}).then(function(){pending--;return refresh(false,true);});render();},
  addleave:function(){
    var l=draft.leave;
    if(!l.staffId||!l.from||!l.to){l.err='Chọn nhân viên, ngày bắt đầu và ngày kết thúc.';render();return;}
    if(l.to<l.from){l.err='Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.';render();return;}
    l.err='';put('leaves',newId('l'),{staffId:l.staffId,from:l.from,to:l.to,note:l.note||''});
    draft.leave={staffId:'',from:'',to:'',note:''};toast('Đã đánh dấu kỳ nghỉ. Xếp lại lịch để áp dụng.');
  },
  delleave:function(a){del('leaves',a);},
  csv:function(){
    var rows=summaryRows(ym),q=function(v){return '"'+String(v).replace(/"/g,'""')+'"';};
    var out=[['Mã số','Họ tên','Nghỉ phiên (ngày)','Nghỉ phép (ngày)','Ngày làm','K1 (giờ)','K2 (giờ)','K3 (giờ)','Tổng giờ'].map(q).join(',')];
    rows.forEach(function(r){out.push([r.s.code||'',r.s.name,r.P,r.L,r.work,r.K1*HOURS,r.K2*HOURS,r.K3*HOURS,r.hours].map(q).join(','));});
    var text='﻿'+out.join('\r\n');
    try{
      var blob=new Blob([text],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download='tong-hop-'+ym+'.csv';document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);toast('Đã tạo tệp CSV.');
    }catch(e){toast('Không tải được tệp.');}
  }
};
app.addEventListener('click',function(e){
  var t=e.target.closest('[data-act]');if(!t||t.tagName==='SELECT')return;
  var f=ACT[t.dataset.act];if(f)f(t.dataset.arg,t,e);
});
app.addEventListener('change',function(e){
  var t=e.target;
  if(t.tagName==='SELECT'&&t.dataset.act&&ACT[t.dataset.act]){ACT[t.dataset.act](t.dataset.arg,t,e);return;}
  if(t.dataset.bind){setDraft(t.dataset.bind,t.type==='checkbox'?t.checked:t.value);if(t.dataset.re)render();}
});
app.addEventListener('input',function(e){
  var t=e.target;if(t.dataset.bind)setDraft(t.dataset.bind,t.type==='checkbox'?t.checked:t.value);
});

/* ---------- khởi động ---------- */
app.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.enter&&ACT[e.target.dataset.enter]){e.preventDefault();ACT[e.target.dataset.enter]();}
});
function decide(){
  SB.rpc('needs_setup').then(function(r){
    if(r.error){draft.auth.err='Không kết nối được máy chủ. Kiểm tra config.js và mạng.';SCREEN='login';}
    else SCREEN=r.data===true?'setup':'login';
    render();
  });
}
render();
(function init(){
  var cfg=window.VH_CONFIG||{};
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){SCREEN='nocfg';render();return;}
  SB=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  try{TOKEN=localStorage.getItem('vh-token')||'';}catch(e){}
  if(TOKEN)refresh(true).then(function(ok){if(!ok&&SCREEN!=='app')decide();});else decide();
  setInterval(function(){if(SCREEN==='app'&&document.visibilityState==='visible')refresh(false);},15000);
  document.addEventListener('visibilitychange',function(){if(SCREEN==='app'&&document.visibilityState==='visible')refresh(false);});
})();
})();
