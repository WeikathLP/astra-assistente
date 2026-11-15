const token = window.ASTRA_TOKEN;
const $ = id => document.getElementById(id);
let state = null;
let busy = false;
const prefs = JSON.parse(localStorage.getItem('astra-voice') || '{}');

async function api(path, data) {
  const options = {headers: {'X-Astra-Token': token}};
  if (data !== undefined) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 4800);
}

function el(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
}

function addMessage(role, text) {
  const box = $('messages');
  box.querySelector('.empty')?.remove();
  const node = el('div', `message ${role}`);
  node.append(el('span', 'who', role === 'user' ? 'VOCÊ' : 'ASTRA'));
  text.split(/(\*\*[^*]+\*\*)/g).forEach(part => {
    if (part.startsWith('**') && part.endsWith('**')) node.append(el('strong', '', part.slice(2, -2)));
    else node.append(document.createTextNode(part));
  });
  box.append(node); box.scrollTop = box.scrollHeight;
  return node;
}

function render() {
  $('status').textContent = state.ollama_online ? 'SISTEMA ONLINE' : 'OLLAMA DESCONECTADO';
  $('connection').textContent = state.ollama_online ? `${state.models.length} modelo(s) disponível(is)` : 'Abra o Ollama para conversar';
  $('model-badge').textContent = state.model; $('model').textContent = state.model;
  $('computer').textContent = state.system.computer || '—';
  const c = state.system.drives.find(d => d.drive === 'C');
  $('disk').textContent = c ? `${c.free_gib} GiB` : '—';
  $('model-input').value = state.model;
  $('startup').checked = state.startup;
  $('auto-update').checked = state.auto_update;
  $('backup-path').textContent = `OneDrive: ${state.cloud_backup_dir}`;
  const backup = state.backup || {};
  $('backup-status').textContent = backup.error ? `Erro: ${backup.error}` : backup.completed_at ? `Último backup: ${backup.completed_at}${backup.cloud_error ? ' · Falha no OneDrive: ' + backup.cloud_error : ' · OneDrive: OK'}` : 'Aguardando primeiro backup';
  const update = state.update || {};
  $('update-status').textContent = `Versão ${state.version} · ${update.status === 'error' ? 'Erro: ' + update.error : update.status === 'current' ? 'Atualizada' : update.status === 'installed' ? 'Atualização instalada' : 'Verificação pendente'}`;
  $('models').replaceChildren(...state.models.map(name => {const n = el('option'); n.value = name; return n;}));
  $('messages').replaceChildren();
  if (!state.messages.length) $('messages').append(el('div', 'empty', 'Olá. Posso verificar seu computador, abrir arquivos e aplicativos, executar diagnósticos e seguir as regras que você salvar na memória.'));
  state.messages.forEach(m => addMessage(m.role, m.text));
  $('rules-list').replaceChildren(...state.rules.map(rule => item(rule.text, `Salva em ${rule.created_at}`, () => remove('rules', rule.id))));
  $('jobs-list').replaceChildren(...state.jobs.map(job => item(job.prompt, `A cada ${job.interval_minutes} min · Próxima execução: ${job.next_run}`, () => remove('jobs', job.id))));
  $('actions-list').replaceChildren(...state.actions.map(action => {const n = el('div','item'); const details = el('div'); details.append(el('strong','',action.tool), el('small','',`${action.created_at} · ${action.task}`)); const result=el('pre','',action.result); details.append(result); n.append(details); return n;}));
  if (!state.rules.length) $('rules-list').append(el('p','', 'Nenhuma regra salva.'));
  if (!state.jobs.length) $('jobs-list').append(el('p','', 'Nenhuma automação agendada.'));
  if (!state.actions.length) $('actions-list').append(el('p','', 'Nenhuma ação executada.'));
}

function item(title, subtitle, removeFn) {
  const row = el('div','item'), left = el('div'); left.append(el('strong','',title),el('small','',subtitle));
  const button = el('button','', 'REMOVER'); button.addEventListener('click', removeFn); row.append(left,button); return row;
}

async function refresh() { try { state = await api('/api/state'); render(); } catch (error) { toast(error.message); } }
async function remove(kind,id) { try { await api(`/api/${kind}/delete`,{id}); await refresh(); } catch (e) {toast(e.message);} }

function speak(text) {
  if (!$('speak').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0,3500));
  utterance.lang = 'pt-BR'; utterance.rate = Number($('rate').value);
  const selected = speechSynthesis.getVoices().find(v => v.voiceURI === $('voice').value);
  if (selected) utterance.voice = selected;
  speechSynthesis.speak(utterance);
}

function loadVoices() {
  if (!('speechSynthesis' in window)) { $('voice').append(el('option','', 'Voz indisponível')); return; }
  const voices = speechSynthesis.getVoices().sort((a,b) => Number(b.lang.startsWith('pt')) - Number(a.lang.startsWith('pt')));
  $('voice').replaceChildren(...voices.map(v => {const o=el('option','',`${v.name} (${v.lang})`);o.value=v.voiceURI;return o;}));
  if (prefs.voice) $('voice').value = prefs.voice;
  else { const pt=voices.find(v=>v.lang.startsWith('pt')); if(pt) $('voice').value=pt.voiceURI; }
}

document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b===button));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${button.dataset.tab}`));
}));

$('chat-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const prompt = $('prompt').value.trim(); if (!prompt) return;
  busy=true; $('send').disabled=true; $('prompt').value=''; addMessage('user',prompt);
  const pending=addMessage('assistant','Processando tarefa…');
  try { const result=await api('/api/chat',{prompt}); pending.remove(); addMessage('assistant',result.answer); speak(result.answer); await refresh(); }
  catch(error) {pending.remove(); addMessage('assistant',`Erro: ${error.message}`);toast(error.message);}
  finally {busy=false;$('send').disabled=false;$('prompt').focus();}
});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('chat-form').requestSubmit();}});
$('rule-form').addEventListener('submit',async event=>{event.preventDefault();try{await api('/api/rules',{text:$('rule-text').value});$('rule-text').value='';await refresh();toast('Regra salva.');}catch(e){toast(e.message);}});
$('job-form').addEventListener('submit',async event=>{event.preventDefault();try{await api('/api/jobs',{prompt:$('job-prompt').value,interval_minutes:Number($('job-interval').value)});$('job-prompt').value='';await refresh();toast('Rotina criada.');}catch(e){toast(e.message);}});
$('save-model').addEventListener('click',async()=>{try{await api('/api/settings',{model:$('model-input').value});await refresh();toast('Modelo salvo.');}catch(e){toast(e.message);}});
$('startup').addEventListener('change',async()=>{try{await api('/api/startup',{enabled:$('startup').checked});await refresh();toast('Início com Windows atualizado.');}catch(e){toast(e.message);await refresh();}});
$('backup-now').addEventListener('click',async()=>{try{const result=await api('/api/backup',{});await refresh();toast(result.cloud ? 'Backup local e no OneDrive concluído.' : `Backup local feito; OneDrive: ${result.cloud_error || result.error}`);}catch(e){toast(e.message);}});
$('auto-update').addEventListener('change',async()=>{try{await api('/api/auto-update',{enabled:$('auto-update').checked});await refresh();toast('Atualização automática configurada.');}catch(e){toast(e.message);await refresh();}});
$('test-voice').addEventListener('click',()=>speak('Olá. Eu sou a Astra, seu assistente pessoal.'));
$('voice').addEventListener('change',saveVoice);$('rate').addEventListener('input',()=>{$('rate-label').textContent=`${Number($('rate').value).toFixed(1)}×`;saveVoice();});$('speak').addEventListener('change',saveVoice);
function saveVoice(){localStorage.setItem('astra-voice',JSON.stringify({voice:$('voice').value,rate:$('rate').value,speak:$('speak').checked}));}
if(prefs.rate){$('rate').value=prefs.rate;$('rate-label').textContent=`${Number(prefs.rate).toFixed(1)}×`;} if(prefs.speak!==undefined)$('speak').checked=prefs.speak;
if('speechSynthesis' in window){speechSynthesis.onvoiceschanged=loadVoices;loadVoices();}
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(Recognition){const rec=new Recognition();rec.lang='pt-BR';rec.interimResults=false;rec.onresult=e=>{$('prompt').value=e.results[0][0].transcript;$('prompt').focus();};rec.onerror=e=>toast(`Microfone: ${e.error}`);$('mic').addEventListener('click',()=>{try{rec.start();toast('Ouvindo…');}catch(e){toast(e.message);}});}else{$('mic').disabled=true;$('mic').title='Ditado indisponível neste navegador';}
setInterval(()=>$('clock').textContent=new Date().toLocaleString('pt-BR'),1000);$('clock').textContent=new Date().toLocaleString('pt-BR');
refresh();setInterval(()=>{if(!busy)refresh();},30000);
