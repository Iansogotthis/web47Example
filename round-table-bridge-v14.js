(function(){
  'use strict';

  var ADAPTER_URL='https://round-table-native-seat-adapter-ryz3wo.v2.appdeploy.ai/';
  var ADAPTER_ORIGIN='https://round-table-native-seat-adapter-ryz3wo.v2.appdeploy.ai';
  var FREE_RELAY_INSTALL='https://raw.githubusercontent.com/Iansogotthis/web47Example/main/round-table-free-relay.user.js';
  var DB_NAME='round-table-v9';
  var STORES=['rooms','projects','sessions','seats','turns','artifacts','revisions','events','claims','gaps','checkpoints','state'];
  var DRIVE_DOC='https://docs.google.com/document/d/1eeYMO7zTY0bWtG0odqkg8_BKIjodFoAHwMtw0vNueSo';
  var adapterWindow=null;
  var adapterReady=null;
  var pendingNative={};
  var pendingFree={};
  var freeStatus={TL:false,MUSE:false,lastUpdate:0};
  var bypass=false;

  function $(q){return document.querySelector(q)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
  function uuid(){return crypto.randomUUID?crypto.randomUUID():'rt-'+Date.now()+'-'+Math.random().toString(16).slice(2)}
  function now(){return new Date().toISOString()}
  function note(title,detail){
    var st=$('#st'),sd=$('#sd'),toast=$('#toast');
    if(st)st.textContent=title;
    if(sd)sd.textContent=detail||'';
    if(toast){toast.textContent=title+(detail?' · '+detail:'');toast.classList.add('show');setTimeout(function(){toast.classList.remove('show')},3600)}
  }

  function openDb(){
    return new Promise(function(resolve,reject){
      var request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=function(){for(var i=0;i<STORES.length;i++)if(!request.result.objectStoreNames.contains(STORES[i]))request.result.createObjectStore(STORES[i],{keyPath:'id'})};
      request.onsuccess=function(){resolve(request.result)};
      request.onerror=function(){reject(request.error||new Error('ROUND TABLE database unavailable'))};
    });
  }

  function all(db,store){
    return new Promise(function(resolve,reject){
      var request=db.transaction(store,'readonly').objectStore(store).getAll();
      request.onsuccess=function(){resolve(request.result)};
      request.onerror=function(){reject(request.error)};
    });
  }

  function put(db,store,value){
    return new Promise(function(resolve,reject){
      var request=db.transaction(store,'readwrite').objectStore(store).put(value);
      request.onsuccess=function(){resolve(value)};
      request.onerror=function(){reject(request.error)};
    });
  }

  async function ensureCore(db){
    var rooms=await all(db,'rooms'),room=rooms[0];
    if(!room){room={id:uuid(),name:'ROUND TABLE'};await put(db,'rooms',room)}
    var projects=(await all(db,'projects')).filter(function(x){return x.roomId===room.id});
    if(!projects.length){var project={id:uuid(),roomId:room.id,name:'Book Project'};await put(db,'projects',project);projects=[project]}
    var seats=(await all(db,'seats')).filter(function(x){return x.roomId===room.id});
    var defs=[['Ian','human','Round Table'],['TL','ai','ChatGPT'],['Muse','ai','Muse']];
    for(var i=0;i<defs.length;i++){
      var d=defs[i];
      if(!seats.some(function(x){return x.label===d[0]})){
        await put(db,'seats',{id:uuid(),roomId:room.id,label:d[0],type:d[1],environment:d[2],transport:d[1]==='ai'?'local-browser':'manual',endpoint:'',context:d[0]+' developed position',connection:d[1]==='ai'?'FREE LOCAL RELAY':'CONNECTED'});
      }
    }
    seats=(await all(db,'seats')).filter(function(x){return x.roomId===room.id});
    var project=projects[0],sessions=(await all(db,'sessions')).filter(function(x){return x.projectId===project.id});
    if(!sessions.length){var session={id:uuid(),roomId:room.id,projectId:project.id,name:'EXPANDITURE-2026-10-10-A'};await put(db,'sessions',session);sessions=[session]}
    var states=(await all(db,'state')).filter(function(x){return x.roomId===room.id}),state=states[0];
    var tl=seats.find(function(x){return x.label==='TL'}),muse=seats.find(function(x){return x.label==='Muse'});
    if(!state){state={id:uuid(),roomId:room.id,target:'Build the relation before decorating the room.',truth:'State must survive focus changes.',totally:'Preserve distinctions.',title:'ROUND TABLE',nextMove:'Operate free local TL ↔ Muse.',floor:'OPEN',focus:null,aiSeatA:tl&&tl.id,aiSeatB:muse&&muse.id,bridgeDocUrl:DRIVE_DOC,nativeAdapterVersion:4,preferredTransport:'local-browser'};await put(db,'state',state)}
    if(tl&&(!tl.transport||tl.transport==='native-adapter')){tl.transport='local-browser';tl.endpoint='';tl.connection='FREE LOCAL RELAY';await put(db,'seats',tl)}
    if(muse&&(!muse.transport||muse.transport==='native-adapter')){muse.transport='local-browser';muse.endpoint='';muse.connection='FREE LOCAL RELAY';await put(db,'seats',muse)}
    state.aiSeatA=tl?tl.id:state.aiSeatA;state.aiSeatB=muse?muse.id:state.aiSeatB;state.bridgeDocUrl=state.bridgeDocUrl||DRIVE_DOC;state.nativeAdapterVersion=4;state.preferredTransport=state.preferredTransport||'local-browser';await put(db,'state',state);
    return{room:room,project:project,session:sessions[0],seats:seats,state:state};
  }

  async function bootstrapShell(){
    var db;
    try{
      db=await openDb();var core=await ensureCore(db),project=$('#project'),session=$('#session'),seatA=$('#seatA'),seatB=$('#seatB'),speaker=$('#speaker'),to=$('#to');
      if(project){project.innerHTML='<option value="'+core.project.id+'">'+esc(core.project.name)+'</option>';project.value=core.project.id}
      if(session){session.innerHTML='<option value="'+core.session.id+'">'+esc(core.session.name)+'</option>';session.value=core.session.id}
      var ais=core.seats.filter(function(x){return x.type==='ai'}),tl=ais.find(function(x){return x.label==='TL'}),muse=ais.find(function(x){return x.label==='Muse'}),opts=ais.map(function(x){return'<option value="'+x.id+'">'+esc(x.label)+' · '+esc(x.environment||'')+'</option>'}).join('');
      if(seatA){seatA.innerHTML=opts;if(tl)seatA.value=tl.id}if(seatB){seatB.innerHTML=opts;if(muse)seatB.value=muse.id}
      if(speaker){speaker.innerHTML=core.seats.map(function(x){return'<option value="'+x.id+'">'+esc(x.label)+'</option>'}).join('');var ian=core.seats.find(function(x){return x.label==='Ian'});if(ian)speaker.value=ian.id}
      if(to)to.innerHTML='<option value="ALL">TO: ALL</option>'+ais.map(function(x){return'<option value="'+x.id+'">TO: '+esc(x.label)+'</option>'}).join('');
      if($('#bridgeDoc'))$('#bridgeDoc').value=core.state.bridgeDocUrl||DRIVE_DOC;
      var turns=(await all(db,'turns')).filter(function(x){return x.sessionId===core.session.id}).sort(function(a,b){return(a.seq||0)-(b.seq||0)}),stream=$('#turns');
      if(stream)stream.innerHTML=turns.length?turns.map(function(x){return'<div class="turn"><div class="mono">'+esc(x.turnId)+' · '+esc(x.source||'external')+' · '+esc(x.mode||'normal')+'</div><strong>'+esc(x.speaker)+'</strong><div>'+esc(x.body)+'</div></div>'}).join(''):'<div class="muted">No turns yet.</div>';
      if($('#floor'))$('#floor').textContent=core.state.floor||'OPEN';
      note('Room ready','Free local relay is primary · TL and Muse stay in their native browser conversations.');
      refreshFreeUi();
    }catch(err){note('ROUND TABLE bridge bootstrap failed',String(err&&err.message||err))}finally{if(db)try{db.close()}catch(_){}}
  }

  async function addHumanTurn(){
    var db;
    try{
      var body=$('#body')&&$('#body').value.trim();if(!body)return note('Turn is empty','Write or dictate something first.');
      db=await openDb();var core=await ensureCore(db),speakerId=$('#speaker')&&$('#speaker').value,speaker=core.seats.find(function(x){return x.id===speakerId})||core.seats.find(function(x){return x.label==='Ian'}),toValue=$('#to')&&$('#to').value,targets=toValue==='ALL'?core.seats.filter(function(x){return x.type==='ai'}).map(function(x){return x.id}):[toValue],turns=(await all(db,'turns')).filter(function(x){return x.sessionId===core.session.id}),count=turns.filter(function(x){return x.seat===speaker.id}).length+1;
      var created={id:uuid(),roomId:core.room.id,projectId:core.project.id,sessionId:core.session.id,turnId:speaker.label.toUpperCase().replace(/[^A-Z0-9]/g,'')+'#'+count,seat:speaker.id,speaker:speaker.label,body:body,source:($('#prov')&&$('#prov').value)||'external',reply:null,ref:null,mode:'normal',to:targets,seq:turns.length+1,createdAt:now()};
      await put(db,'turns',created);core.state.focus=created.id;await put(db,'state',core.state);if($('#body'))$('#body').value='';
      note('Turn added',created.turnId+' · '+speaker.label);
    }catch(err){note('Turn add failed',String(err&&err.message||err))}finally{if(db)try{db.close()}catch(_){}}await bootstrapShell();
  }

  function sessionId(){var el=$('#session');return el?el.value:''}
  function projectId(){var el=$('#project');return el?el.value:''}

  async function roomContext(db){
    var states=await all(db,'state');
    var state=states[0]||null;
    var seats=await all(db,'seats');
    var sid=sessionId();
    var turns=(await all(db,'turns')).filter(function(x){return x.sessionId===sid}).sort(function(a,b){return (a.seq||0)-(b.seq||0)});
    return{state:state,seats:seats,turns:turns,sessionId:sid,projectId:projectId()};
  }

  function canonicalSeat(seat){return seat&&(seat.label==='TL'||seat.label==='Muse')}
  function seatCode(seat){return seat.label==='Muse'?'MUSE':'TL'}
  function transportLabel(seat){return seat&&seat.transport==='native-adapter'?'paid native adapter':'free local relay'}

  async function setCanonicalTransport(mode){
    var db;
    try{
      db=await openDb();var ctx=await roomContext(db);
      var tl=ctx.seats.find(function(x){return x.label==='TL'}),muse=ctx.seats.find(function(x){return x.label==='Muse'});
      if(!tl||!muse)return;
      [tl,muse].forEach(function(s){s.transport=mode;s.endpoint=mode==='native-adapter'?ADAPTER_URL:'';s.connection=mode==='native-adapter'?'NATIVE ADAPTER':'FREE LOCAL RELAY'});
      await put(db,'seats',tl);await put(db,'seats',muse);
      if(ctx.state){ctx.state.aiSeatA=tl.id;ctx.state.aiSeatB=muse.id;ctx.state.preferredTransport=mode;await put(db,'state',ctx.state)}
      note(mode==='local-browser'?'Free local relay active':'Native adapter active',mode==='local-browser'?'No TinyFish or paid model API required. Keep the pinned TL and Muse tabs open in Firefox.':'Paid/native adapter remains available as an optional fallback.');
      refreshFreeUi();
    }catch(err){note('Transport binding failed',String(err&&err.message||err))}finally{if(db)try{db.close()}catch(_){}}
  }

  function refreshFreeUi(){
    var el=$('#freeRelayStatus');
    if(!el)return;
    var age=Date.now()-(freeStatus.lastUpdate||0);
    var fresh=age<7000;
    var tl=fresh&&freeStatus.TL,muse=fresh&&freeStatus.MUSE;
    el.textContent='TL '+(tl?'ONLINE':'WAITING')+' · MUSE '+(muse?'ONLINE':'WAITING')+(tl&&muse?' · automatic circuit ready':' · open and pin both native conversations');
    el.className='mono '+(tl&&muse?'ok':'');
  }

  function injectUi(){
    var seatMode=$('#seatMode');
    if(seatMode&&!seatMode.querySelector('option[value="local-browser"]')){
      var local=document.createElement('option');local.value='local-browser';local.textContent='Free Local Browser Relay';seatMode.insertBefore(local,seatMode.firstChild);
    }
    if(seatMode&&!seatMode.querySelector('option[value="native-adapter"]')){
      var native=document.createElement('option');native.value='native-adapter';native.textContent='Native TL / Muse Adapter';seatMode.appendChild(native);
    }
    var seatsPanel=$('#seatsPanel .pb');if(!seatsPanel)return;
    if(!$('#freeRelayBox')){
      var box=document.createElement('div');box.className='bridgebox';box.id='freeRelayBox';
      box.innerHTML="<div class='sectionLabel'>FREE LOCAL RELAY · $0 TRANSPORT</div><div class='muted'>Runs on your Android browser. ROUND TABLE sends the event to the already-open native TL or Muse conversation; the local userscript submits it, waits for that seat's actual ROUND_TABLE_EVENT reply, and returns it here. No TinyFish, no paid model API.</div><div class='bridge-actions' style='margin-top:8px'><a class='navlink primary' id='installFreeRelay' href='"+FREE_RELAY_INSTALL+"' target='_blank' rel='noopener'>Install free relay</a><button class='btn primary' id='applyFreeRelay'>Use free relay</button><button class='btn' id='checkFreeRelay'>Check local seats</button></div><div id='freeRelayStatus' class='mono' style='margin-top:7px'>Waiting for local relay…</div></div>";
      var firstBridge=seatsPanel.querySelector('.bridgebox');
      if(firstBridge)seatsPanel.insertBefore(box,firstBridge);else seatsPanel.insertBefore(box,seatsPanel.firstChild);
      $('#applyFreeRelay').onclick=function(){setCanonicalTransport('local-browser')};
      $('#checkFreeRelay').onclick=function(){window.postMessage({type:'ROUND_TABLE_FREE_PING'},location.origin);setTimeout(refreshFreeUi,500);note('Local relay check','TL '+(freeStatus.TL?'online':'waiting')+' · Muse '+(freeStatus.MUSE?'online':'waiting'))};
    }
    var existingApply=$('#applyNative'),existingOpen=$('#openAdapter');
    if(existingApply)existingApply.onclick=function(){setCanonicalTransport('native-adapter')};
    if(existingOpen)existingOpen.onclick=function(){openAdapter();note('Adapter opened','Optional paid fallback only. The free local relay does not use it.')};
    refreshFreeUi();
  }

  function updateNativeStatus(text){var el=$('#nativeAdapterStatus'),existing=$('#nativeStatus');if(el)el.textContent=text;if(existing)existing.textContent=text}

  function openAdapter(){
    adapterReady=null;
    adapterWindow=window.open(ADAPTER_URL,'roundTableNativeAdapter','popup=yes,width=520,height=720');
    if(!adapterWindow){note('Popup blocked','Allow popups for ROUND TABLE, then try again.');return null}
    try{adapterWindow.focus()}catch(_){ }
    updateNativeStatus('Adapter window opened · checking owner session…');
    return adapterWindow;
  }

  function waitForReady(timeoutMs){
    return new Promise(function(resolve,reject){
      var started=Date.now();
      (function check(){
        if(adapterReady===true)return resolve(true);
        if(Date.now()-started>timeoutMs)return reject(new Error('Owner authentication not confirmed.'));
        setTimeout(check,250);
      })();
    });
  }

  function sendNativeRun(entry){
    if(!adapterWindow||adapterWindow.closed)return entry.reject(new Error('Adapter window closed.'));
    adapterWindow.postMessage({type:'ROUND_TABLE_RUN',seat:entry.seat,event:entry.event,requestId:entry.requestId},ADAPTER_ORIGIN);
    if(!entry.retryTimer){
      entry.retryTimer=setInterval(function(){
        if(!pendingNative[entry.requestId]){clearInterval(entry.retryTimer);entry.retryTimer=null;return}
        if(adapterWindow&&!adapterWindow.closed)adapterWindow.postMessage({type:'ROUND_TABLE_RUN',seat:entry.seat,event:entry.event,requestId:entry.requestId},ADAPTER_ORIGIN);
      },1200);
    }
    updateNativeStatus(entry.seat+' running in native account…');
  }

  function runNativeSeat(seat,event){
    return new Promise(function(resolve,reject){
      if(!adapterWindow||adapterWindow.closed){if(!openAdapter())return reject(new Error('Adapter popup blocked.'))}
      var requestId=uuid();
      var entry={requestId:requestId,seat:seat,event:event,resolve:resolve,reject:reject,timer:null,retryTimer:null};
      entry.timer=setTimeout(function(){if(pendingNative[requestId]){delete pendingNative[requestId];if(entry.retryTimer)clearInterval(entry.retryTimer);reject(new Error('Native seat timed out.'))}},360000);
      pendingNative[requestId]=entry;
      if(adapterReady===true)sendNativeRun(entry);else waitForReady(90000).then(function(){sendNativeRun(entry)}).catch(function(err){if(pendingNative[requestId]){delete pendingNative[requestId];clearTimeout(entry.timer);reject(err)}});
    });
  }

  function runFreeSeat(seat,event){
    return new Promise(function(resolve,reject){
      var requestId=uuid();
      var entry={requestId:requestId,seat:seat,event:event,resolve:resolve,reject:reject,timer:null,retryTimer:null};
      pendingFree[requestId]=entry;
      function emit(){window.postMessage({type:'ROUND_TABLE_FREE_RUN',seat:seat,event:event,requestId:requestId},location.origin)}
      emit();
      entry.retryTimer=setInterval(function(){if(pendingFree[requestId])emit();else clearInterval(entry.retryTimer)},1500);
      entry.timer=setTimeout(function(){if(pendingFree[requestId]){delete pendingFree[requestId];clearInterval(entry.retryTimer);reject(new Error('Free local relay timed out. Keep the '+seat+' native conversation open and pinned in Firefox.'))}},360000);
      note('Routing '+seat,'Free local relay · no paid transport.');
    });
  }

  window.addEventListener('message',function(message){
    var data=message.data||{};
    if(message.source===window&&message.origin===location.origin){
      if(data.type==='ROUND_TABLE_FREE_STATUS'){
        freeStatus.TL=!!(data.seats&&data.seats.TL);freeStatus.MUSE=!!(data.seats&&data.seats.MUSE);freeStatus.lastUpdate=Date.now();refreshFreeUi();return;
      }
      if(data.type==='ROUND_TABLE_FREE_PROGRESS'){
        if(data.requestId&&pendingFree[data.requestId])note((data.seat||'Seat')+' · local relay',data.detail||data.status||'working');return;
      }
      if(data.type==='ROUND_TABLE_FREE_RESULT'&&data.requestId&&pendingFree[data.requestId]){
        var freeEntry=pendingFree[data.requestId];delete pendingFree[data.requestId];clearTimeout(freeEntry.timer);if(freeEntry.retryTimer)clearInterval(freeEntry.retryTimer);
        if(data.ok&&data.event)freeEntry.resolve(data.event);else freeEntry.reject(new Error(data.error||'Free local seat returned no usable event.'));
        return;
      }
    }
    if(message.origin!==ADAPTER_ORIGIN)return;
    if(data.type==='ROUND_TABLE_ADAPTER_READY'){
      adapterReady=!!data.signedIn;
      updateNativeStatus(adapterReady?'Adapter authenticated · ready':'Adapter open · owner sign-in required');
      if(adapterReady)Object.keys(pendingNative).forEach(function(k){sendNativeRun(pendingNative[k])});
      return;
    }
    if(data.type==='ROUND_TABLE_ADAPTER_AUTH_REQUIRED'){
      adapterReady=false;
      if(data.requestId&&pendingNative[data.requestId]&&pendingNative[data.requestId].retryTimer){clearInterval(pendingNative[data.requestId].retryTimer);pendingNative[data.requestId].retryTimer=null}
      updateNativeStatus('Owner sign-in required in adapter window');note('Adapter sign-in required','Complete owner sign-in in the adapter window.');return;
    }
    if(data.type==='ROUND_TABLE_ADAPTER_PROGRESS'){
      if(data.requestId&&pendingNative[data.requestId]&&pendingNative[data.requestId].retryTimer){clearInterval(pendingNative[data.requestId].retryTimer);pendingNative[data.requestId].retryTimer=null}
      updateNativeStatus((data.seat||'Seat')+' · '+(data.status||'RUNNING'));return;
    }
    if(data.type==='ROUND_TABLE_ADAPTER_RESULT'&&data.requestId&&pendingNative[data.requestId]){
      var entry=pendingNative[data.requestId];delete pendingNative[data.requestId];clearTimeout(entry.timer);if(entry.retryTimer)clearInterval(entry.retryTimer);
      if(data.ok&&data.event){updateNativeStatus((data.seat||entry.seat)+' returned to ROUND TABLE');entry.resolve(data.event)}
      else entry.reject(new Error(data.error||'Native seat returned no usable event.'));
    }
  });

  function parseReturnedEvent(raw){
    if(raw&&typeof raw==='object')return raw;
    var text=String(raw||'').trim();
    try{var parsed=JSON.parse(text);if(parsed&&parsed.protocol==='ROUND_TABLE_EVENT_V1')return parsed}catch(_){ }
    var bodyMatch=text.match(/(?:^|\n)body:\s*\n?([\s\S]*?)(?:\n\[\/ROUND_TABLE_EVENT\]|$)/i);
    var fromMatch=text.match(/(?:^|\n)from:\s*([^\n]+)/i);
    var turnMatch=text.match(/(?:^|\n)turn_id:\s*([^\n]+)/i);
    var eventMatch=text.match(/(?:^|\n)event_id:\s*([^\n]+)/i);
    var replyMatch=text.match(/(?:^|\n)reply_to:\s*([^\n]+)/i);
    if(bodyMatch)return{protocol:'ROUND_TABLE_EVENT_V1',body:bodyMatch[1].trim(),from:fromMatch?fromMatch[1].trim():'',turn_id:turnMatch?turnMatch[1].trim():'',event_id:eventMatch?eventMatch[1].trim():'',reply_to:replyMatch?replyMatch[1].trim():''};
    throw new Error('Returned native response was not a ROUND_TABLE_EVENT_V1 envelope.');
  }

  function speakerCode(turn){
    var s=String(turn.speaker||'ROUND_TABLE').toUpperCase().replace(/[^A-Z0-9]/g,'');
    return s==='IAN'||s==='TL'||s==='MUSE'?s:'ROUND_TABLE';
  }

  function outboundEvent(ctx,seat,target){
    return{protocol:'ROUND_TABLE_EVENT_V1',event_id:'rt-'+uuid(),turn_id:target.turnId,from:speakerCode(target),to:seatCode(seat),room:'ROUND TABLE',project_id:ctx.projectId,session_id:ctx.sessionId,mode:target.mode||'normal',reply_to:target.transportEventId||target.turnId||'NONE',reference:target.ref||'NONE',provenance:target.source||'external',status:'OPEN',timestamp:now(),artifact_refs:'NONE',claim_refs:'NONE',gap_refs:'NONE',decision_refs:'NONE',body:target.body};
  }

  async function addSeatTurn(db,ctx,seat,target,outbound,raw){
    var returned=parseReturnedEvent(raw);
    if(!returned.body)throw new Error('Native event body is empty.');
    var expected=seatCode(seat),actual=String(returned.from||'').toUpperCase();
    if(actual&&actual!==expected)throw new Error('Seat provenance mismatch: expected '+expected+', received '+actual+'.');
    if(returned.reply_to&&returned.reply_to!=='NONE'&&returned.reply_to!==outbound.event_id&&returned.reply_to!==outbound.turn_id){
      throw new Error('Reply lineage mismatch: '+seat.label+' did not answer the dispatched TL/IAN event.');
    }
    var current=(await all(db,'turns')).filter(function(x){return x.sessionId===ctx.sessionId});
    var number=current.filter(function(x){return x.seat===seat.id}).length+1;
    var created={id:uuid(),roomId:target.roomId||(ctx.state&&ctx.state.roomId)||seat.roomId,projectId:ctx.projectId,sessionId:ctx.sessionId,turnId:seat.label.toUpperCase().replace(/[^A-Z0-9]/g,'')+'#'+number,seat:seat.id,speaker:seat.label,body:String(returned.body),source:'external',reply:target.id,ref:null,mode:'normal',to:[],seq:current.length+1,createdAt:now(),transportEventId:returned.event_id||null,nativeTurnId:returned.turn_id||null,nativeReplyTo:returned.reply_to||null,transport:seat.transport||'local-browser'};
    await put(db,'turns',created);
    if(ctx.state){ctx.state.focus=created.id;await put(db,'state',ctx.state)}
    return created;
  }

  async function answerSeat(db,ctx,seat,target){
    var current=(await all(db,'turns')).filter(function(x){return x.sessionId===ctx.sessionId});
    if(current.some(function(x){return x.seat===seat.id&&x.reply===target.id&&x.mode==='normal'})){
      note('Duplicate blocked',seat.label+' already answered '+target.turnId);return null;
    }
    var outbound=outboundEvent(ctx,seat,target),raw;
    if(seat.transport==='native-adapter')raw=await runNativeSeat(seatCode(seat),outbound);
    else raw=await runFreeSeat(seatCode(seat),outbound);
    return await addSeatTurn(db,ctx,seat,target,outbound,raw);
  }

  function refreshRoundTable(){bootstrapShell()}

  async function doOpenTable(button){
    var db;
    try{
      db=await openDb();var ctx=await roomContext(db);
      if(ctx.state&&ctx.state.floor==='HOLD'){note('Table held','Tap Hold to reopen.');return}
      var target=ctx.turns.slice().reverse().find(function(x){return x.to&&x.to.length});
      if(!target){note('Nothing to route','Add an addressed turn first.');return}
      var addressed=ctx.seats.filter(function(s){return target.to.indexOf(s.id)>=0&&s.type==='ai'});
      if(!addressed.length){note('No addressed AI seat','Choose TO: ALL or TL / Muse.');return}
      if(addressed.some(function(s){return !canonicalSeat(s)})){db.close();bypass=true;button.click();return}
      for(var i=0;i<addressed.length;i++)await answerSeat(db,ctx,addressed[i],target);
      note('Open Table complete',addressed.map(function(s){return s.label+' via '+transportLabel(s)}).join(' + '));
      refreshRoundTable();
    }catch(err){note('Seat routing failed',String(err&&err.message||err))}finally{if(db)try{db.close()}catch(_){}}
  }

  async function doCrossTalk(button){
    var db;
    try{
      db=await openDb();var ctx=await roomContext(db),q=ctx.state;
      var a=q&&ctx.seats.find(function(s){return s.id===q.aiSeatA}),b=q&&ctx.seats.find(function(s){return s.id===q.aiSeatB});
      if(!canonicalSeat(a)||!canonicalSeat(b)||a.id===b.id){db.close();bypass=true;button.click();return}
      var rounds=parseInt(prompt('Cross-talk turns: 2 or 4','2'),10);if(rounds!==2&&rounds!==4)return;
      var cur=ctx.turns[ctx.turns.length-1];if(!cur){note('Add a starting turn first','Cross-talk needs a target turn.');return}
      for(var i=0;i<rounds;i++){
        var seat=i%2===0?a:b;
        var next=await answerSeat(db,ctx,seat,cur);
        if(!next)break;
        cur=next;
      }
      note('Cross-talk complete',rounds+' seat pass'+(rounds===1?'':'es')+' executed · '+transportLabel(a)+'.');
      refreshRoundTable();
    }catch(err){note('Cross-talk stopped',String(err&&err.message||err))}finally{if(db)try{db.close()}catch(_){}}
  }

  document.addEventListener('click',function(ev){
    var button=ev.target&&ev.target.closest?ev.target.closest('#openTable,#crossTalk,#crossFromTable,#saveSeat,#testSeat,#send'):null;
    if(!button)return;
    if(button.id==='send'){ev.preventDefault();ev.stopImmediatePropagation();addHumanTurn();return}
    if(bypass){bypass=false;return}
    if(button.id==='saveSeat'||button.id==='testSeat'){
      var mode=$('#seatMode');if(!mode||(mode.value!=='local-browser'&&mode.value!=='native-adapter'))return;
      ev.preventDefault();ev.stopImmediatePropagation();
      (async function(){
        var db;
        try{
          db=await openDb();var idEl=$('#seatId'),seats=await all(db,'seats'),seat=seats.find(function(s){return idEl&&s.id===idEl.value});
          if(!seat)return note('Choose a seat','Configure TL or Muse first.');
          seat.transport=mode.value;seat.endpoint=mode.value==='native-adapter'?ADAPTER_URL:'';seat.connection=mode.value==='native-adapter'?'NATIVE ADAPTER':'FREE LOCAL RELAY';await put(db,'seats',seat);
          note(button.id==='saveSeat'?'Seat saved':'Transport ready',seat.label+' · '+seat.connection);refreshRoundTable();
        }catch(err){note('Seat transport error',String(err&&err.message||err))}finally{if(db)try{db.close()}catch(_){}}
      })();
      return;
    }
    ev.preventDefault();ev.stopImmediatePropagation();
    if(button.id==='openTable')doOpenTable(button);else doCrossTalk(button);
  },true);

  var booted=false;
  function boot(){
    if(booted)return;
    if(!$('#st')){setTimeout(boot,50);return}
    booted=true;
    bootstrapShell();
    injectUi();
    window.postMessage({type:'ROUND_TABLE_FREE_PING'},location.origin);
    setInterval(function(){window.postMessage({type:'ROUND_TABLE_FREE_PING'},location.origin);refreshFreeUi()},3000);
    setTimeout(function(){bootstrapShell();injectUi();setCanonicalTransport('local-browser')},900);
  }
  boot();
})();
