const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function normalizarListaPdf(pdfInputs) {
    if (Array.isArray(pdfInputs)) {
        return pdfInputs;
    }

    return [pdfInputs];
}

function obterMensagemErro(error) {
    return error.response?.data?.message
        || error.response?.data?.error
        || error.message
        || 'Erro desconhecido na extração via n8n.';
}

function obterChaveResultado(caminhoPdf) {
    return path.basename(String(caminhoPdf), path.extname(String(caminhoPdf)));
}

async function extrairDadosComIA(pdfInputs, perfil) {
    const webhookConfig = perfil?.configuracoes_fixas?.n8n_webhook;
    if (!webhookConfig) {
        throw new Error('Configuração "n8n_webhook" ausente no perfil do bot.');
    }
    const ambiente = webhookConfig.ambiente;
    const urls = webhookConfig.urls;
    if (!ambiente || !urls) {
        throw new Error('Configuração de ambiente ou URLs do webhook ausente no perfil.');
    }
    const webhookUrl = urls[ambiente];
    if (!webhookUrl) {
        throw new Error(`URL do webhook não configurada para o ambiente: "${ambiente}".`);
    }

    const arquivosPdf = normalizarListaPdf(pdfInputs);
    const retorno = {
        total: arquivosPdf.length,
        sucesso: 0,
        falha: 0,
        resultados: {}
    };
    // 1. Captura o usuário logado no Windows
    const usuarioWindows = os.userInfo().username;
    
    
    const TAMANHO_LOTE = 10; // Processa até 10 arquivos simultaneamente

    for (let i = 0; i < arquivosPdf.length; i += TAMANHO_LOTE) {
        const lote = arquivosPdf.slice(i, i + TAMANHO_LOTE);
        
        // Cria as promessas para os envios paralelos no lote atual
        const promessas = lote.map(async (caminhoPdf) => {
            const form = new FormData();
            // Gera o ID único DESTA tentativa exata
            const idExecucao = crypto.randomUUID();
            // Extrai o nome do arquivo (ex: de "C:/docs/SEI_12345.pdf" pega "SEI_12345")
            const nomeArquivo = path.parse(caminhoPdf).name;
            
            form.append('file', fs.createReadStream(caminhoPdf));
            form.append('usuario_maquina', usuarioWindows);
            form.append('processo_origem', nomeArquivo);
            form.append('id_execucao', idExecucao);

            if (perfil) {
                form.append('perfil', perfil.nome);
            }

            try {
                const response = await axios.post(webhookUrl, form, {
                    headers: {
                        ...form.getHeaders()
                    }
                });

                if (response.data && response.data.msg_erro) {
                    const msg = String(response.data.msg_erro).trim();
                    if (msg.length > 0) {
                        const feedback = response.data.feedback ? ` | Feedback: ${String(response.data.feedback).trim()}` : '';
                        return {
                            caminhoPdf,
                            sucesso: false,
                            id_execucao: idExecucao,
                            erro: `${msg}${feedback}`
                        };
                    }
                }

                return {
                    caminhoPdf,
                    sucesso: true,
                    id_execucao: idExecucao,
                    resposta: response.data
                };
            } catch (error) {
                return {
                    caminhoPdf,
                    sucesso: false,
                    id_execucao: idExecucao,
                    erro: obterMensagemErro(error)
                };
            }
        });

        // Aguarda todas as requisições do lote finalizarem
        const resultadosLote = await Promise.all(promessas);

        // Organiza as respostas
        for (const res of resultadosLote) {
            const chave = obterChaveResultado(res.caminhoPdf);
            if (res.sucesso) {
                retorno.sucesso += 1;
                retorno.resultados[chave] = {
                    sucesso: true,
                    resposta: res.resposta,
                    id_execucao: res.id_execucao
                };
            } else {
                retorno.falha += 1;
                retorno.resultados[chave] = {
                    sucesso: false,
                    erro: res.erro,
                    id_execucao: res.id_execucao
                };
            }
        }
    }

    return retorno;
}

module.exports = { extrairDadosComIA };
