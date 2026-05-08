var session=null, taskData=null;
window.addEventListener("DOMContentLoaded",init);
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function init(){
  var raw=window.SkillingAuth?window.SkillingAuth.read():null;
  if(raw&&raw.user&&raw.access_token){
    session={id:raw.user.id,name:raw.user.displayName||raw.user.email.split("@")[0],email:raw.user.email||"",access_token:raw.access_token,skill_domain:raw.user.skill_domain||"",level:raw.user.level||"Beginner",points:raw.user.points||0};
  }
  if(!session){window.location.href="/login.html";return;}
  var raw2=sessionStorage.getItem("skilling_task_detail");
  if(!raw2){window.location.href="/arena.html";return;}
  try{taskData=JSON.parse(raw2);}catch(e){window.location.href="/arena.html";return;}
  renderTask();
  generateSteps();
}
function renderTask(){
  var t=taskData;
  var vid=t.videoId||"";
  var thumb=t.thumbnail||(vid?"https://img.youtube.com/vi/"+vid+"/hqdefault.jpg":"");
  document.getElementById("tdThumb").src=thumb;
  document.getElementById("tdTitle").textContent=t.title||"Task";
  document.getElementById("tdDesc").textContent=t.desc||t.objective||"";
  document.getElementById("tdDomain").textContent=t.domain||"General";
  document.getElementById("tdLevel").textContent=t.level||"Beginner";
  document.getElementById("tdEffort").textContent=t.effort||"~1 hr";
  var pts=10;
  var lv=(t.level||"").toLowerCase();
  if(lv.includes("inter")) pts=20;
  else if(lv.includes("adv")) pts=50;
  document.getElementById("tdPointsValue").textContent=pts;
  document.getElementById("tdPointsSmall").textContent=pts+" pts";
  if(vid){
    var seg=t.watchSegment||"";
    var startSec=0;
    if(seg){var m=seg.match(/(\d+):(\d+)/);if(m)startSec=parseInt(m[1])*60+parseInt(m[2]);}
    document.getElementById("tdVideoFrame").src="https://www.youtube.com/embed/"+vid+"?rel=0"+(startSec?"&start="+startSec:"");
    if(seg){document.getElementById("tdWatchBadge").style.display="inline-flex";document.getElementById("tdWatchSegText").textContent="Watch: "+seg;}
  } else {
    document.getElementById("tdVideoSection").style.display="none";
  }
}
function nextSixAM(){var d=new Date();d.setHours(6,0,0,0);if(Date.now()>=d.getTime())d.setDate(d.getDate()+1);return d.getTime();}
async function generateSteps(){
  var container=document.getElementById("tdSteps");
  try{
    var r=await fetch("/api/ai/task-steps",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},
      body:JSON.stringify({title:taskData.title,desc:taskData.desc||"",domain:taskData.domain||"",level:taskData.level||"Beginner",effort:taskData.effort||"~1 hr"})
    });
    var d=await r.json();
    if(d.steps&&d.steps.length){renderSteps(d.steps);return;}
  }catch(e){console.warn("Steps API failed, using defaults");}
  renderSteps([
    {title:"Set up your environment",body:"Install required tools, libraries, and dependencies. Create your project folder and files."},
    {title:"Watch the tutorial segment",body:"Watch the highlighted portion of the video above. Take notes on the key concepts and code patterns."},
    {title:"Build the core feature",body:"Implement the main functionality described in the task. Follow along with the video but write the code yourself."},
    {title:"Add your own improvements",body:"Do not just copy. Add something unique: better UI, extra features, error handling, or comments."},
    {title:"Test and verify",body:"Run your code, fix any errors, and make sure it produces the expected output. Take screenshots of results."},
    {title:"Submit your work",body:"Upload your code file, paste your GitHub link, and add screenshots. The AI will auto-evaluate your submission."}
  ]);
}
function renderSteps(steps){
  var container=document.getElementById("tdSteps");
  container.innerHTML=steps.map(function(s,i){
    return '<div class="td-step"><div class="td-step-num">'+(i+1)+'</div><div class="td-step-content"><div class="td-step-title">'+esc(s.title)+'</div><div class="td-step-body">'+esc(s.body||s.description||"")+'</div></div></div>';
  }).join("");
}
async function confirmAndGo(){
  var btn=document.getElementById("tdConfirmBtn");
  var info=document.getElementById("tdConfirmInfo");
  btn.disabled=true;btn.textContent="Locking in...";
  info.textContent="Confirming your task...";
  var vid=taskData.videoId||"";
  var pairedVideo=vid?{title:taskData.videoTitle||taskData.title,id:vid,thumbnail:taskData.thumbnail||(vid?"https://img.youtube.com/vi/"+vid+"/hqdefault.jpg":""),embedUrl:"https://www.youtube.com/embed/"+vid,watchUrl:"https://www.youtube.com/watch?v="+vid,channel:taskData.channel||""}:null;
  var chosenTask={title:taskData.title,domain:taskData.domain||"",id:taskData.id||"",desc:taskData.desc||"",effort:taskData.effort||"~1 hr",confirmed:true,lock_until:nextSixAM(),pairedVideo:pairedVideo,source:"task-detail",skill_domain:session.skill_domain||""};
  sessionStorage.setItem("skilling_chosen_task",JSON.stringify(chosenTask));
  try{await fetch("/api/cycles/select-task",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},body:JSON.stringify({taskId:taskData.id||""})});}catch(e){}
  info.textContent="Task locked! Heading to Submit...";
  btn.textContent="Confirmed!";
  setTimeout(function(){window.location.href="/submit.html";},600);
}