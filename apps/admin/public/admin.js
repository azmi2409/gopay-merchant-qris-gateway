const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value||0));
const escapeHtml = (value) => String(value??'').replace(/[&<>'"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const json = (value) => escapeHtml(JSON.stringify(value,null,2));
const endpoints = [
  {method:'POST',path:'/api/v1/qris',auth:'x-api-key or Bearer JWT',summary:'Create dynamic QRIS',body:{amount:50000,reference:'INV-001',callback_url:'https://merchant.example/payment',attributes:{customer_id:'CUST-99'}},response:{success:true,data:{id:'qris_example',trx_id:'TRX-EXAMPLE',status:'PENDING',amount:50000,qris_url:'https://gateway.example/qr/qris_example'}}},
  {method:'GET',path:'/api/v1/qris/:id',auth:'Public',summary:'Read QRIS metadata',params:[['id','path','string','QRIS ID returned during creation']],response:{success:true,data:{id:'qris_example',trx_id:'TRX-EXAMPLE',amount:50000,status:'PENDING',reference:'INV-001'}}},
  {method:'GET',path:'/api/v1/qris/:id/status',auth:'Public',summary:'Poll payment status',params:[['id','path','string','QRIS ID']],response:{success:true,paid:false,status:'PENDING'}},
  {method:'GET',path:'/qr/:id',auth:'Public',summary:'Open customer payment page',params:[['id','path','string','QRIS ID'],['download','query','0 | 1','Download a PNG when set to 1']],response:'HTML payment page or PNG download'},
  {method:'POST',path:'/api/v1/payments/verify',auth:'x-api-key or Bearer JWT',summary:'Verify settlement manually',body:{qris_id:'qris_example'},response:{success:true,paid:true,trx_id:'TRX-EXAMPLE'}},
  {method:'GET',path:'/api/v1/transactions',auth:'x-api-key or Bearer JWT',summary:'List GoPay transactions',params:[['startTime','query','ISO 8601','Range start'],['endTime','query','ISO 8601','Range end'],['limit','query','number','Maximum records']],response:{success:true,data:[{transaction_id:'synthetic-transaction',amount:50000,status:'SUCCESS'}]}},
  {method:'GET',path:'/api/v1/session/status',auth:'x-api-key or Bearer JWT',summary:'Check GoBiz session',response:{success:true,data:{configured:true,status:'valid'}}},
  {method:'POST',path:'/api/v1/webhooks',auth:'x-api-key or Bearer JWT',summary:'Register webhook',body:{url:'https://merchant.example/webhooks/gopay',events:['payment.success'],secret:'use-a-unique-webhook-secret'},response:{success:true,data:{id:'whk_example',url:'https://merchant.example/webhooks/gopay',events:['payment.success']}}},
  {method:'GET',path:'/api/v1/webhooks',auth:'x-api-key or Bearer JWT',summary:'List webhooks',response:{success:true,data:[]}},
  {method:'DELETE',path:'/api/v1/webhooks/:id',auth:'x-api-key or Bearer JWT',summary:'Delete webhook',params:[['id','path','string','Webhook ID']],response:{success:true,message:'Webhook deleted'}},
  {method:'POST',path:'/api/v1/webhooks/test',auth:'x-api-key or Bearer JWT',summary:'Send test event',body:{event:'payment.success'},response:{success:true,delivered:1}},
  {method:'GET',path:'/api/v1/healthz',auth:'Public',summary:'Liveness and readiness probe',response:{status:'healthy'}}
];

async function api(path, options={}) {
  const response = await fetch(`/admin/api${path}`,{...options,headers:{'content-type':'application/json',...options.headers}});
  const body = await response.json();
  if(!response.ok) throw new Error(body.message||'Request failed');
  return body.data;
}
function renderDashboard(data, panel){
  const s=data.summary;
  $('#metrics').innerHTML=[['QRIS created',s.total],['Successful',s.paid],['Paid volume',money(s.paid_volume)],['Conversion',`${s.conversion_rate}%`]].map(([label,value])=>`<article class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></article>`).join('');
  const max=Math.max(...data.daily.map((row)=>Number(row.amount)),1);
  $('#chart').innerHTML=data.daily.length?data.daily.map((row)=>`<div class="bar h${Math.max(0,Math.ceil(Number(row.amount)/max*10))}" title="${escapeHtml(row.day)}: ${money(row.amount)}"></div>`).join(''):'<p class="muted">No paid activity in this range.</p>';
  $('#chart-caption').textContent=`Last ${data.range_days} days`;
  const checks=[
    ['Static QRIS (Wajib)', data.setup.qris_configured],
    ['GoBiz Account (Opsional)', data.setup.session_configured],
    ['Mode Verifikasi', data.setup.mode === 'full' ? 'Otomatis' : (data.setup.mode === 'generation_only' ? 'Manual' : 'Belum Lengkap')]
  ];
  $('#readiness').innerHTML=checks.map(([label,val])=>`<div class="check"><span>${label}</span><b>${typeof val === 'boolean' ? (val ? 'Ready' : 'Pending') : val}</b></div>`).join('');
  $('#transactions').innerHTML=data.recent.map((row)=>`<tr><td><code>${escapeHtml(row.trx_id||row.id)}</code></td><td>${escapeHtml(row.reference||'-')}</td><td><span class="badge ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td><td>${money(row.amount)}</td><td>${new Date(String(row.created_at)).toLocaleString()}</td><td>${row.status === 'PENDING' ? `<button class="btn-mark-paid small" data-id="${escapeHtml(row.id)}">Tandai Lunas</button>` : '-'}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No QRIS records yet.</td></tr>';
  document.querySelectorAll('.btn-mark-paid').forEach(btn => btn.addEventListener('click', () => panel.markAsPaid(btn.dataset.id)));
  
  // Only static QRIS is strictly required to unblock onboarding
  const qrisReady = Boolean(data.setup.qris_configured);
  panel.onboarding = !qrisReady;
  panel.ready = qrisReady;
  panel.connection = data.setup.mode === 'full' ? 'Gateway Ready (Auto)' : (data.setup.mode === 'generation_only' ? 'Gateway Ready (Manual)' : 'Setup Needed');
  
  const steps = [
    ['Static QRIS (Wajib)', qrisReady],
    ['GoBiz Auto-Check (Opsional)', Boolean(data.setup.session_configured)]
  ];
  $('#onboarding-progress').innerHTML=steps.map(([label,ready],index)=>`<div class="progress-step ${ready?'done':''}"><span>${ready?'OK':String(index+1).padStart(2,'0')}</span><b>${label}</b></div>`).join('');
  
  if(panel.onboarding && !panel.onboardingChecked) panel.setView('setup');
  panel.onboardingChecked=true;
}
async function loadLogs(){try{const logs=await api('/logs');$('#log-list').innerHTML=logs.map((log)=>`<div class="log"><time>${new Date(String(log.timestamp)).toLocaleString()}</time><strong class="${escapeHtml(log.type)}">${escapeHtml(log.type)}</strong><span>${escapeHtml(log.message)}</span></div>`).join('')||'<p class="muted">No activity logged yet.</p>'}catch(error){$('#log-list').textContent=error.message}}
async function loadWebhooks(panel){
  try{
    const hooks=await api('/webhooks');
    $('#webhook-list').innerHTML=hooks.map((hook)=>`<div class="webhook"><div><strong>${escapeHtml(hook.url)}</strong><span>${escapeHtml(hook.events.join(', '))}${hook.has_secret?' / signed':''}</span></div><button class="remove-webhook" data-id="${escapeHtml(hook.id)}">Remove</button></div>`).join('')||'<p class="muted">No webhooks registered.</p>';
    document.querySelectorAll('.remove-webhook').forEach((button)=>button.addEventListener('click',()=>panel.removeWebhook(button.dataset.id)));
  }catch(error){$('#webhook-list').textContent=error.message}
}
async function decodeQrisImage(file, panel){
  if(!file)return;
  if(!file.type.startsWith('image/')){panel.decodeMessage='Choose a PNG, JPEG, WebP, or GIF image.';return}
  if(file.size>10*1024*1024){panel.decodeMessage='Image must be smaller than 10 MB.';return}
  if(!('BarcodeDetector' in window)){panel.decodeMessage='This browser cannot decode QR images locally. Use current Chrome or Edge, or paste the QRIS payload below.';return}
  panel.decodeMessage='Reading QR image locally...';
  try{
    const bitmap=await createImageBitmap(file);
    const detector=new BarcodeDetector({formats:['qr_code']});
    const codes=await detector.detect(bitmap);
    bitmap.close();
    const payload=codes.find((code)=>code.rawValue)?.rawValue?.trim();
    if(!payload){throw new Error('No QR code found. Try a sharper, tightly cropped image.')}
    panel.qrisStatic=payload;
    panel.decodeMessage='QR code decoded locally. Review and save the configuration.';
  }catch(error){panel.decodeMessage=error.message||'Could not decode this QR image.'}
}

$('#endpoints').innerHTML=endpoints.map((endpoint,index)=>`<details class="endpoint" ${index===0?'open':''}><summary><span class="method ${endpoint.method}">${endpoint.method}</span><code>${endpoint.path}</code><strong>${endpoint.summary}</strong><span class="auth">${endpoint.auth}</span></summary><div class="endpoint-body">${endpoint.params?`<h4>Parameters</h4><div class="param-table">${endpoint.params.map(([name,location,type,description])=>`<div><code>${name}</code><span>${location}</span><span>${type}</span><p>${description}</p></div>`).join('')}</div>`:''}${endpoint.body?`<h4>Request body <small>application/json</small></h4><pre><code>${json(endpoint.body)}</code></pre>`:''}<h4>Example response</h4><pre><code>${typeof endpoint.response==='string'?escapeHtml(endpoint.response):json(endpoint.response)}</code></pre></div></details>`).join('');

document.addEventListener('alpine:init',()=>{
  Alpine.data('adminPanel',()=>({
    authenticated:false,password:'',loginError:'',view:'overview',range:'30',ready:false,
    connection:'Checking gateway',onboarding:false,onboardingChecked:false,qrisStatic:'',
    merchantId:'',settingsMessage:'',decodeMessage:'',phone:'',otp:'',otpRequested:false,
    otpMessage:'',verifyMessage:'',generateAmount:'',generateReference:'',generateCallback:'',
    generateMessage:'',generatedQris:false,generatedImageUrl:'',generatedPaymentUrl:'',
    generatedTransaction:'',generatedExpiry:'',generatedAmount:'',webhookUrl:'',webhookSecret:'',webhookMessage:'',
    get pageTitle(){return {overview:'Overview',generate:'Generate QRIS',setup:'Gateway setup',docs:'API docs',logs:'Activity logs'}[this.view]},
    async init(){const session=await api('/session');this.authenticated=session.authenticated;if(this.authenticated)await this.loadDashboard()},
    async login(){try{await api('/login',{method:'POST',body:JSON.stringify({password:this.password})});this.authenticated=true;this.password='';await this.loadDashboard()}catch(error){this.loginError=error.message}},
    async logout(){await api('/logout',{method:'POST'});location.reload()},
    setView(name){if(this.onboarding&&['overview','generate'].includes(name))return;this.view=name;if(name==='logs')this.loadLogs();if(name==='setup')this.loadWebhooks()},
    async loadDashboard(){try{renderDashboard(await api(`/dashboard?days=${this.range}`),this)}catch(error){this.connection=error.message;this.ready=false}},
    async loadLogs(){await loadLogs()},
    async loadWebhooks(){await loadWebhooks(this)},
    async generateQris(){try{const data=await api('/qris',{method:'POST',body:JSON.stringify({amount:this.generateAmount,reference:this.generateReference,callback_url:this.generateCallback})});this.generatedQris=true;this.generatedImageUrl=`/admin/api/qris/${data.qris_id}/image`;this.generatedPaymentUrl=data.qris_url;this.generatedTransaction=data.trx_id;this.generatedExpiry=new Date(data.expires_at).toLocaleString();this.generatedAmount=money(data.amount);this.generateMessage='QRIS created. It expires in five minutes.';await this.loadDashboard()}catch(error){this.generatedQris=false;this.generateMessage=error.message}},
    async saveSettings(){try{await api('/settings',{method:'PUT',body:JSON.stringify({qris_static:this.qrisStatic,merchant_id:this.merchantId})});this.settingsMessage='Settings saved securely.';this.qrisStatic='';await this.loadDashboard()}catch(error){this.settingsMessage=error.message}},
    async decodeQris(event){await decodeQrisImage(event.target.files?.[0],this)},
    async requestOtp(){try{const result=await api('/setup/otp',{method:'POST',body:JSON.stringify({phone:this.phone})});this.otpMessage=`OTP sent. Expires in ${result?.expires_in||720} seconds.`;this.otpRequested=true}catch(error){this.otpMessage=error.message}},
    async verifyOtp(){try{await api('/setup/verify',{method:'POST',body:JSON.stringify({otp:this.otp})});this.verifyMessage='GoBiz account connected.';this.otp='';await this.loadDashboard()}catch(error){this.verifyMessage=error.message}},
    async registerWebhook(){try{await api('/webhooks',{method:'POST',body:JSON.stringify({url:this.webhookUrl,secret:this.webhookSecret,events:['payment.success']})});this.webhookMessage='Webhook verified and registered.';this.webhookUrl='';this.webhookSecret='';await this.loadWebhooks()}catch(error){this.webhookMessage=error.message}},
    async removeWebhook(id){try{await api(`/webhooks/${encodeURIComponent(id)}`,{method:'DELETE'});this.webhookMessage='Webhook removed.';await this.loadWebhooks()}catch(error){this.webhookMessage=error.message}},
    async markAsPaid(id){if(!confirm('Tandai transaksi ini sebagai Lunas secara manual?'))return;try{await api(`/qris/${encodeURIComponent(id)}/mark-paid`,{method:'POST'});await this.loadDashboard()}catch(error){alert('Gagal menandai lunas: '+error.message)}}
  }))
});
