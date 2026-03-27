Atue como um Engenheiro de Software especialista em Tauri v2 e Rust. O projeto acabou de ser migrado para o Tauri v2 e precisamos ajustar a ponte de comunicação e a chamada do executável local.

Execute as seguintes tarefas:

**Tarefa 1: Atualizar Importação no Frontend (Padrão v2)**
Abra o arquivo `src/DownloadManager.ts`. O módulo de invoke mudou no Tauri v2. 
- Altere a importação de: `import { invoke } from '@tauri-apps/api/tauri';`
- Para: `import { invoke } from '@tauri-apps/api/core';`

**Tarefa 2: Ajustar o Motor no Backend (Rust)**
Abra o arquivo `src-tauri/src/main.rs`. Precisamos silenciar os warnings de variáveis não utilizadas (adicionando `_` antes do nome) e referenciar o executável `yt-dlp.exe` local. 
Substitua o conteúdo da função `download_video` por este:

```rust
#[tauri::command]
async fn download_video(url: String, _quality: String, _download_path: String) -> Result<String, String> {
    println!("Iniciando yt-dlp v2 para a URL: {}", url);
    
    // Aponta especificamente para o executável na raiz do projeto no Windows
    let output = tokio::process::Command::new(".\\yt-dlp.exe")
        .arg(&url)
        .output()
        .await
        .map_err(|e| format!("Falha ao executar o yt-dlp.exe. Arquivo não encontrado na raiz: {}", e))?;

    if output.status.success() {
        Ok(format!("Download concluído com sucesso!"))
    } else {
        let error_msg = String::from_utf8_lossy(&output.stderr);
        Err(format!("Erro no yt-dlp: {}", error_msg))
    }
}