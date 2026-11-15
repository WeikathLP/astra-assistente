const token = window.ASTRA_TOKEN;
const $ = id => document.getElementById(id);
let state = null;
let busy = false;
const prefs = JSON.parse(localStorage.getItem('astra-voice') || '{}');
const core = $('astra-core');
const visualizer = $('voice-visualizer');
const visualContext = visualizer.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let audioContext = null;
let audioAnalyser = null;
let audioSource = null;

function setCoreState(mode) {
  const labels = {
    idle: ['PRONTA PARA AJUDAR', 'Pronta para conversar e cuidar do seu computador.'],
    offline: ['MODELO DESCONECTADO', 'Abra o Ollama para conversar com a Astra.'],
    listening: ['OUVINDO VOCÊ', 'Fale naturalmente. Estou ouvindo.'],
    thinking: ['PROCESSANDO', 'Analisando sua solicitação.'],
    speaking: ['ASTRA FALANDO', 'Acompanhe a resposta na conversa.']
  };
  core.dataset.state = mode;
  $('status').textContent = labels[mode][0];
  $('core-hint').textContent = labels[mode][1];
}

function drawVisualizer(time) {
  if (!visualContext) return;
  const ctx = visualContext, width = visualizer.width, center = visualizer.height / 2;
  ctx.clearRect(0, 0, width, visualizer.height);
  const mode = core.dataset.state;
  const data = audioAnalyser && mode === 'speaking' ? new Uint8Array(audioAnalyser.frequencyBinCount) : null;
  if (data) audioAnalyser.getByteFrequencyData(data);
  const bars = 45, step = width / bars;
  for (let i = 0; i < bars; i++) {
    const distance = Math.abs(i - (bars - 1) / 2) / (bars / 2);
    const envelope = Math.pow(1 - distance, 1.6);
    const energy = data ? data[Math.min(data.length - 1, Math.round(i * 2.2))] / 255
      : mode === 'speaking' ? .38 + .32 * Math.abs(Math.sin(time / 110 + i * .72))
      : mode === 'listening' ? .22 + .15 * Math.abs(Math.sin(time / 320 + i * .5))
      : mode === 'thinking' ? .16 + .11 * Math.abs(Math.sin(time / 420 + i * .27)) : .08;
    const height = 3 + (reducedMotion.matches ? 12 : 76) * energy * envelope;
    const x = i * step + step / 2;
    ctx.fillStyle = 'rgba(122, 231, 244, ' + (.22 + .75 * envelope) + ')';
    ctx.fillRect(x - 1.3, center - height / 2, 2.6, height);
  }
  if (!reducedMotion.matches) requestAnimationFrame(drawVisualizer);
}
drawVisualizer(0);

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
  if (core.dataset.state === 'idle' || core.dataset.state === 'offline') setCoreState(state.ollama_online ? 'idle' : 'offline');
  $('core-connection').classList.toggle('disconnected', !state.ollama_online);
  $('core-connection').lastChild.textContent = state.ollama_online ? ' ATIVA' : ' OFFLINE';
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

let neuralVoices = [];
let currentAudio = null;
let currentAudioUrl = null;
let speechRequestId = 0;

function browserSpeak(text, voiceUri) {
  if (!('speechSynthesis' in window)) { toast('Voz do navegador indisponível.'); setCoreState('idle'); return; }
  const utterance = new SpeechSynthesisUtterance(text.slice(0,3500));
  utterance.lang = 'pt-BR';
  utterance.rate = Number($('rate').value);
  utterance.pitch = 1 + Number($('pitch').value) / 100;
  const selected = speechSynthesis.getVoices().find(v => v.voiceURI === voiceUri);
  if (selected) utterance.voice = selected;
  utterance.onstart = () => setCoreState('speaking');
  utterance.onend = () => setCoreState('idle');
  utterance.onerror = () => setCoreState('idle');
  speechSynthesis.speak(utterance);
}

async function speak(text, force = false) {
  if (!force && !$('speak').checked) { setCoreState('idle'); return; }
  const requestId = ++speechRequestId;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (audioSource) { audioSource.disconnect(); audioSource = null; }
  audioAnalyser = null;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (currentAudioUrl) { URL.revokeObjectURL(currentAudioUrl); currentAudioUrl = null; }
  const clean = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_#]/g, '').slice(0,3500);
  const selected = $('voice').value;
  if (!selected.startsWith('edge:')) return browserSpeak(clean, selected.replace(/^browser:/, ''));
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Astra-Token': token},
      body: JSON.stringify({text: clean, voice: selected.slice(5),
                            rate: Math.round((Number($('rate').value) - 1) * 100),
                            pitch: Number($('pitch').value)})
    });
    if (!response.ok) { const problem = await response.json(); throw new Error(problem.error || 'Falha na voz neural'); }
    const blob = await response.blob();
    if (requestId !== speechRequestId) return;
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    currentAudioUrl = audioUrl;
    currentAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) {
        currentAudioUrl = null; currentAudio = null;
        if (audioSource) { audioSource.disconnect(); audioSource = null; }
        audioAnalyser = null; setCoreState('idle');
      }
    };
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioContext ||= new AudioContextClass();
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;
        audioSource = audioContext.createMediaElementSource(audio);
        audioSource.connect(audioAnalyser);
        audioAnalyser.connect(audioContext.destination);
        await audioContext.resume();
      }
    } catch (visualError) {
      audioAnalyser = null;
      if (audioSource) { audioSource.disconnect(); audioSource.connect(audioContext.destination); }
    }
    await audio.play();
    setCoreState('speaking');
  } catch (error) {
    if (requestId !== speechRequestId) return;
    toast(`Voz neural indisponível: ${error.message}. Usando voz do navegador.`);
    browserSpeak(clean, '');
  }
}

function renderVoiceOptions() {
  const previous = prefs.voice || (neuralVoices.length ? 'edge:pt-BR-ThalitaMultilingualNeural' : $('voice').value);
  const neural = el('optgroup'); neural.label = 'VOZES NEURAIS ONLINE';
  neuralVoices.forEach(v => {const option=el('option','',v.label);option.value=`edge:${v.name}`;neural.append(option);});
  const local = el('optgroup'); local.label = 'VOZES DO NAVEGADOR';
  const browsers = 'speechSynthesis' in window ? speechSynthesis.getVoices().filter(v=>v.lang.startsWith('pt')) : [];
  browsers.forEach(v => {const option=el('option','',`${v.name} (${v.lang})`);option.value=`browser:${v.voiceURI}`;local.append(option);});
  $('voice').replaceChildren(neural,local);
  if (previous && [...$('voice').options].some(o=>o.value===previous)) $('voice').value=previous;
  else if (neuralVoices.length) $('voice').value=`edge:${neuralVoices[0].name}`;
}

async function loadNeuralVoices() {
  try { neuralVoices = (await api('/api/voices')).voices; }
  catch (error) { neuralVoices = []; }
  renderVoiceOptions();
}

document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b===button));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${button.dataset.tab}`));
}));

$('chat-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const prompt = $('prompt').value.trim(); if (!prompt) return;
  busy=true; setCoreState('thinking'); $('send').disabled=true; $('prompt').value=''; addMessage('user',prompt);
  const pending=addMessage('assistant','Processando tarefa…');
  try { const result=await api('/api/chat',{prompt}); pending.remove(); addMessage('assistant',result.answer); speak(result.answer); await refresh(); }
  catch(error) {pending.remove(); addMessage('assistant',`Erro: ${error.message}`);toast(error.message);setCoreState('idle');}
  finally {busy=false;$('send').disabled=false;$('prompt').focus();}
});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('chat-form').requestSubmit();}});
$('rule-form').addEventListener('submit',async event=>{event.preventDefault();try{await api('/api/rules',{text:$('rule-text').value});$('rule-text').value='';await refresh();toast('Regra salva.');}catch(e){toast(e.message);}});
$('job-form').addEventListener('submit',async event=>{event.preventDefault();try{await api('/api/jobs',{prompt:$('job-prompt').value,interval_minutes:Number($('job-interval').value)});$('job-prompt').value='';await refresh();toast('Rotina criada.');}catch(e){toast(e.message);}});
$('save-model').addEventListener('click',async()=>{try{await api('/api/settings',{model:$('model-input').value});await refresh();toast('Modelo salvo.');}catch(e){toast(e.message);}});
$('startup').addEventListener('change',async()=>{try{await api('/api/startup',{enabled:$('startup').checked});await refresh();toast('Início com Windows atualizado.');}catch(e){toast(e.message);await refresh();}});
$('backup-now').addEventListener('click',async()=>{try{const result=await api('/api/backup',{});await refresh();toast(result.cloud ? 'Backup local e no OneDrive concluído.' : `Backup local feito; OneDrive: ${result.cloud_error || result.error}`);}catch(e){toast(e.message);}});
$('auto-update').addEventListener('change',async()=>{try{await api('/api/auto-update',{enabled:$('auto-update').checked});await refresh();toast('Atualização automática configurada.');}catch(e){toast(e.message);await refresh();}});
const voicePreview = () => speak('Olá. Eu sou a Astra, seu assistente pessoal. Posso ajudar você hoje?', true);
$('test-voice').addEventListener('click', voicePreview);
$('core-test').addEventListener('click', voicePreview);
$('voice').addEventListener('change',saveVoice);$('rate').addEventListener('input',()=>{$('rate-label').textContent=`${Number($('rate').value).toFixed(1)}×`;saveVoice();});$('pitch').addEventListener('input',()=>{$('pitch-label').textContent=`${Number($('pitch').value)} Hz`;saveVoice();});$('speak').addEventListener('change',saveVoice);
function saveVoice(){prefs.voice=$('voice').value;prefs.rate=$('rate').value;prefs.pitch=$('pitch').value;prefs.speak=$('speak').checked;localStorage.setItem('astra-voice',JSON.stringify(prefs));}
if(prefs.rate){$('rate').value=prefs.rate;$('rate-label').textContent=`${Number(prefs.rate).toFixed(1)}×`;} if(prefs.pitch){$('pitch').value=prefs.pitch;$('pitch-label').textContent=`${Number(prefs.pitch)} Hz`;} if(prefs.speak!==undefined)$('speak').checked=prefs.speak;
if('speechSynthesis' in window){speechSynthesis.onvoiceschanged=renderVoiceOptions;renderVoiceOptions();}
loadNeuralVoices();
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(Recognition){const rec=new Recognition();rec.lang='pt-BR';rec.interimResults=false;rec.onstart=()=>setCoreState('listening');rec.onend=()=>setCoreState('idle');rec.onresult=e=>{$('prompt').value=e.results[0][0].transcript;$('prompt').focus();};rec.onerror=e=>{setCoreState('idle');toast(`Microfone: ${e.error}`);};$('mic').addEventListener('click',()=>{try{rec.start();toast('Ouvindo…');}catch(e){toast(e.message);}});}else{$('mic').disabled=true;$('mic').title='Ditado indisponível neste navegador';}
setInterval(()=>$('clock').textContent=new Date().toLocaleString('pt-BR'),1000);$('clock').textContent=new Date().toLocaleString('pt-BR');
refresh();setInterval(()=>{if(!busy)refresh();},30000);
