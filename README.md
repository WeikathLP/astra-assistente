# Astra — assistente pessoal local para Windows

Astra é um aplicativo local com painel no navegador, modelo de IA servido pelo Ollama, regras persistentes, automações recorrentes, voz configurável e registro de ações.

## Iniciar

1. Instale o [Ollama para Windows](https://ollama.com/download/windows).
2. Em um terminal, execute `ollama pull qwen3.5:9b`. O modelo ocupa aproximadamente 7 GB. Se o desempenho for baixo, use `ollama pull qwen3.5:4b` e troque o nome em **Configurações**.
3. Dê dois cliques em `start_astra.bat`. O painel abre no navegador. Em **Configurações**, você pode ativar **Iniciar Astra com o Windows** para manter as rotinas funcionando após reiniciar.

Não é necessária chave de API. As conversas, regras, agendamentos e registros ficam em `%LOCALAPPDATA%\Astra\astra.db` no computador. O programa ouve apenas em `127.0.0.1` e usa um token de sessão para as ações no painel.

## Backup e recuperação

A Astra faz cópias consistentes do SQLite ao iniciar e a cada cinco minutos enquanto estiver aberta. Mantém até 30 cópias em `%LOCALAPPDATA%\Astra\backups` e até 90 cópias em `%OneDrive%\Astra\Backups`. Cada cópia tem um arquivo `.json` com SHA-256. A aba **Backup e updates** mostra o estado e permite fazer uma cópia na hora. Os backups contêm conversas, regras, agendamentos e histórico de ações; ficam fora do GitHub. O OneDrive precisa estar conectado e sincronizando para a cópia remota sobreviver a um problema no PC.

Para recuperar em outro Windows: baixe o projeto do GitHub, instale Python e Ollama, feche a Astra e execute:

```powershell
python backup.py restore "C:\Users\SEU_USUARIO\OneDrive\Astra\Backups\astra-EXEMPLO.sqlite3"
```

O restaurador valida o banco e o SHA-256 quando o manifesto `.json` está presente. Se já houver memória local, guarda uma cópia `astra-before-restore.sqlite3` antes da troca.

## Atualizações

O código público fica em [WeikathLP/astra-assistente](https://github.com/WeikathLP/astra-assistente). A Astra consulta a release mais recente a cada seis horas. Quando encontra versão maior, baixa o código dessa release, valida `version.json`, salva a versão anterior, atualiza apenas os arquivos do aplicativo e reinicia. O banco em `%LOCALAPPDATA%` não é substituído. A opção pode ser desligada na aba **Backup e updates**. Para que funcione após reiniciar o PC, ative **Iniciar Astra com o Windows** em Configurações.

Para publicar uma nova versão, altere `version.json`, execute os testes, faça commit e crie uma release com tag correspondente, por exemplo `v0.1.1`. O atualizador usa o arquivo de código da release do GitHub.

## Recursos disponíveis

- Consultar espaço em disco e informações do Windows.
- Listar pastas e ler arquivos de texto.
- Abrir arquivos, pastas e programas.
- Criar pastas, escrever arquivos de texto com backup e mover arquivos dentro do perfil do usuário.
- Executar diagnósticos: disco, GPU (incluindo temperatura), rede, erros do Visualizador de Eventos, integridade do Windows, arquivos do sistema e `chkdsk /scan`.
- Executar reparos solicitados: `DISM /RestoreHealth`, `sfc /scannow` e limpeza do cache DNS. A Astra solicita a elevação pelo Windows quando necessária, executa o reparo e traz o resultado; você não precisa abrir o prompt.
- Guardar regras e executar tarefas recorrentes enquanto o aplicativo estiver aberto.
- Ler respostas com cinco vozes neurais femininas online (Thalita, Francisca, Raquel, Ava e Emma), além das vozes do navegador. Velocidade e tom são ajustáveis.
- Gravar pelo microfone selecionado em Configurações e transcrever em português no próprio PC. O primeiro uso baixa o modelo Whisper small; clique uma vez para gravar e novamente para transcrever.
- Visualizar o núcleo central da interface: ele indica quando a Astra escuta, processa e fala; com voz neural, as barras acompanham o áudio reproduzido.
- Ouvir uma amostra da voz escolhida. O motor de voz online é instalado automaticamente quando necessário.
- Iniciar a voz neural assim que o primeiro trecho de áudio chega, sem esperar a frase inteira, e manter o modelo Ollama carregado por 30 minutos entre solicitações.
- Enviar o idioma português correspondente à voz neural escolhida (Brasil ou Portugal), evitando que vozes multilíngues alternem o idioma da fala.

As ações oferecidas pela Astra não exibem confirmação a cada execução. O Windows ainda pode pedir permissão de administrador. A Astra não possui controle completo de mouse/teclado nem exclusão permanente de arquivos nesta versão. As vozes neurais usam o serviço online do Microsoft Edge: o texto escolhido para fala é enviado para gerar o áudio. O modelo Ollama, a memória e a transcrição do microfone continuam locais. Algumas vozes do navegador também podem usar serviços externos.

## Executar testes

```powershell
python -m unittest discover -s tests -v
```

## Arquivos

- `assistant.py`: servidor local, memória, agente, ferramentas e agendamentos.
- `backup.py`: cópias e restauração da memória.
- `updater.py`: instalação de novas releases e recuperação da versão anterior.
- `web/`: interface visual.
- `%LOCALAPPDATA%\Astra`: dados locais criados na primeira execução.
