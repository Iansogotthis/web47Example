// ==UserScript==
// @name         ROUND TABLE Free Local Relay
// @namespace    https://chatgpt-u576299q.webondemand.com/
// @version      1.0.0
// @description  Free, local TL ↔ Muse transport for ROUND TABLE. Uses your already-open native conversations and shared userscript storage. No TinyFish or paid model API.
// @match        https://chatgpt-u576299q.webondemand.com/*
// @match        https://chatgpt.com/*
// @match        https://muse.ai/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.addValueChangeListener
// @grant        GM.notification
// @run-at       document-idle
// ==/UserScript==

(function(){
  'use strict';

  const HOST=location.hostname;
  const ROUND_TABLE_HOST='chatgpt-u576299q.webondemand.com';
  const SEAT=HOST==='chatgpt.com'?'TL':HOST==='muse.ai'?'MUSE':null;
  const PREFIX='round_table_free_relay_v1_';
  const JOB_KEY=seat=>PREFIX+'job_'+seat;
  const RESULT_KEY=PREFIX+'result';
  const HEARTBEAT_KEY=seat=>PREFIX+'heartbeat_'+seat;
  const PIN_KEY=seat=>PREFIX+'pinned_'+seat;
  const LAST_JOB_KEY=seat=>PREFIX+'last_job_'+seat;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=el=>!!(el&&el.isConnected&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  async function getValue(key,fallback){try{return await GM.getValue(key,fallback)}catch(_){return fallback}}
  async function setValue(key,value){return GM.setValue(key,value)}

  function allEnvelopes(text){
    const blocks=[];
    const re=/\[ROUND_TABLE_EVENT\][\s\S]*?\[\/ROUND_TABLE_EVENT\]/g;
    let match;
    while((match=re.exec(text||''))){
      const block=match[0];
      const id=(block.match(/(?:^|\n)event_id:\s*([^\n]+)/i)||[])[1];
      if(id)blocks.push({id:id.trim(),text:block});
    }
    return blocks;
  }

  function pageText(){return document.body?document.body.innerText||'':''}

  function composerCandidates(){
    const selectors=[
      'textarea[data-testid="prompt-textarea"]',
      '#prompt-textarea',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea',
      '[contenteditable="true"][data-lexical-editor="true"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]'
    ];
    const seen=new Set(),out=[];
    for(const sel of selectors){
      for(const el of document.querySelectorAll(sel)){
        if(seen.has(el)||!visible(el))continue;
        const rect=el.getBoundingClientRect();
        if(rect.width<120||rect.height<20)continue;
        seen.add(el);out.push(el);
      }
    }
    return out.sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom);
  }

  function findComposer(){return composerCandidates()[0]||null}

  function setComposer(el,text){
    el.focus();
    if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){
      const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter)setter.call(el,text);else el.value=text;
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return;
    }
    const selection=getSelection();
    const range=document.createRange();
    range.selectNodeContents(el);selection.removeAllRanges();selection.addRange(range);
    let ok=false;
    try{ok=document.execCommand('insertText',false,text)}catch(_){ }
    if(!ok){el.textContent=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}))}
  }

  function sendCandidates(){
    const selectors=[
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[title*="Send" i]',
      'button[type="submit"]'
    ];
    const out=[],seen=new Set();
    for(const sel of selectors){
      for(const el of document.querySelectorAll(sel)){
        if(seen.has(el)||!visible(el)||el.disabled)continue;
        seen.add(el);out.push(el);
      }
    }
    return out;
  }

  async function submitComposer(composer){
    for(let i=0;i<20;i++){
      const button=sendCandidates()[0];
      if(button){button.click();return true}
      await sleep(200);
    }
    composer.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    composer.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    return true;
  }

  function relayPrompt(job){
    return 'ROUND TABLE LOCAL TRANSPORT. You are the native '+job.seat+' seat in the already-developed conversation currently open in this tab. Treat the following as an incoming ROUND TABLE event. Reply with ONLY one complete ROUND_TABLE_EVENT_V1 envelope. Preserve your developed conversational position, set provenance: external, and set reply_to to the incoming event_id. Do not synthesize another seat and do not claim transport you did not receive.\n\n'+serializeEvent(job.event);
  }

  function serializeEvent(event){
    if(typeof event==='string')return event;
    const order=['protocol','event_id','turn_id','from','to','room','project_id','session_id','mode','reply_to','reference','provenance','status','timestamp','artifact_refs','claim_refs','gap_refs','decision_refs'];
    const lines=['[ROUND_TABLE_EVENT]'];
    for(const key of order)lines.push(key+': '+(event?.[key]??'NONE'));
    lines.push('body:');lines.push(String(event?.body??''));lines.push('[/ROUND_TABLE_EVENT]');
    return lines.join('\n');
  }

  async function waitForNewEnvelope(baseline,incomingId,timeoutMs=300000){
    const started=Date.now();
    let candidate=null,stableSince=0;
    while(Date.now()-started<timeoutMs){
      const blocks=allEnvelopes(pageText());
      const fresh=blocks.filter(x=>!baseline.has(x.id)&&x.id!==incomingId);
      if(fresh.length){
        const newest=fresh[fresh.length-1];
        if(candidate?.id===newest.id){
          if(Date.now()-stableSince>1800)return newest.text;
        }else{candidate=newest;stableSince=Date.now()}
      }
      await sleep(700);
    }
    throw new Error('No new ROUND_TABLE_EVENT reply appeared before timeout.');
  }

  async function ensurePinnedConversation(seat){
    const pinned=await getValue(PIN_KEY(seat),'');
    if(!pinned)return true;
    const normalize=u=>String(u).replace(/[#?].*$/,'').replace(/\/$/,'');
    if(normalize(location.href)!==normalize(pinned)){
      location.href=pinned;
      return false;
    }
    return true;
  }

  async function processJob(job){
    if(!SEAT||job.seat!==SEAT)return;
    const last=await getValue(LAST_JOB_KEY(SEAT),'');
    if(last===job.requestId)return;
    await setValue(LAST_JOB_KEY(SEAT),job.requestId);
    await setValue(HEARTBEAT_KEY(SEAT),{online:true,ts:Date.now(),url:location.href,title:document.title});
    try{
      if(!(await ensurePinnedConversation(SEAT)))return;
      const baseline=new Set(allEnvelopes(pageText()).map(x=>x.id));
      let composer=null;
      for(let i=0;i<60&&!composer;i++){composer=findComposer();if(!composer)await sleep(500)}
      if(!composer)throw new Error('Could not find the '+SEAT+' message composer. Open the native conversation and keep this tab foregrounded once for calibration.');
      setComposer(composer,relayPrompt(job));
      await sleep(500);
      await submitComposer(composer);
      const envelope=await waitForNewEnvelope(baseline,String(job.event?.event_id||''));
      await setValue(RESULT_KEY,{requestId:job.requestId,seat:SEAT,ok:true,event:envelope,ts:Date.now()});
      notify(SEAT+' returned to ROUND TABLE');
    }catch(err){
      await setValue(RESULT_KEY,{requestId:job.requestId,seat:SEAT,ok:false,error:String(err?.message||err),ts:Date.now()});
      notify(SEAT+' relay stopped: '+String(err?.message||err));
    }
  }

  function notify(text){try{GM.notification({title:'ROUND TABLE Free Relay',text:String(text),timeout:5000})}catch(_){ }}

  function addSeatWidget(){
    if(!SEAT||document.getElementById('round-table-free-relay-widget'))return;
    const box=document.createElement('div');
    box.id='round-table-free-relay-widget';
    box.style.cssText='position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#111;color:#f2efe8;border:1px solid #c79b52;border-radius:10px;padding:8px;font:12px system-ui;max-width:250px;box-shadow:0 4px 22px #0008';
    box.innerHTML='<div style="font-weight:700">ROUND TABLE · '+SEAT+'</div><div id="rtfr-seat-state" style="opacity:.75;margin:4px 0">Local relay online</div><button id="rtfr-pin" style="background:#c79b52;color:#111;border:0;border-radius:7px;padding:7px 9px;font-weight:700">Pin this conversation</button><button id="rtfr-clear" style="margin-left:5px;background:#222;color:#eee;border:1px solid #555;border-radius:7px;padding:7px 9px">Clear pin</button>';
    document.documentElement.appendChild(box);
    box.querySelector('#rtfr-pin').onclick=async()=>{await setValue(PIN_KEY(SEAT),location.href);box.querySelector('#rtfr-seat-state').textContent='Pinned · automatic routing target';notify(SEAT+' conversation pinned')};
    box.querySelector('#rtfr-clear').onclick=async()=>{await setValue(PIN_KEY(SEAT),'');box.querySelector('#rtfr-seat-state').textContent='Pin cleared';};
    getValue(PIN_KEY(SEAT),'').then(url=>{if(url)box.querySelector('#rtfr-seat-state').textContent='Pinned · automatic routing target'});
  }

  async function seatBoot(){
    addSeatWidget();
    setInterval(()=>setValue(HEARTBEAT_KEY(SEAT),{online:true,ts:Date.now(),url:location.href,title:document.title}),1500);
    const initial=await getValue(JOB_KEY(SEAT),null);if(initial)processJob(initial);
    GM.addValueChangeListener(JOB_KEY(SEAT),(_name,_old,value,remote)=>{if(remote&&value)processJob(value)});
  }

  async function publishStatus(){
    const tl=await getValue(HEARTBEAT_KEY('TL'),null),muse=await getValue(HEARTBEAT_KEY('MUSE'),null),fresh=x=>!!(x&&Date.now()-Number(x.ts||0)<7000);
    window.postMessage({type:'ROUND_TABLE_FREE_STATUS',seats:{TL:fresh(tl),MUSE:fresh(muse)}},location.origin);
  }

  async function roundTableBoot(){
    GM.addValueChangeListener(RESULT_KEY,(_name,_old,value,remote)=>{if(remote&&value)window.postMessage({type:'ROUND_TABLE_FREE_RESULT',...value},location.origin)});
    window.addEventListener('message',async event=>{
      if(event.source!==window||event.origin!==location.origin)return;
      const data=event.data||{};
      if(data.type==='ROUND_TABLE_FREE_PING'){await publishStatus();return}
      if(data.type!=='ROUND_TABLE_FREE_RUN'||!data.requestId||!data.seat||!data.event)return;
      await setValue(JOB_KEY(data.seat),{requestId:data.requestId,seat:data.seat,event:data.event,ts:Date.now()});
      window.postMessage({type:'ROUND_TABLE_FREE_PROGRESS',requestId:data.requestId,seat:data.seat,status:'QUEUED',detail:'Queued in local browser extension storage.'},location.origin);
    });
    setInterval(publishStatus,2000);publishStatus();
  }

  if(HOST===ROUND_TABLE_HOST)roundTableBoot();
  else if(SEAT)seatBoot();
})();
