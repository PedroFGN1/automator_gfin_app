# Instruções de Replicação: Correção da Leitura de PDFs de Certidão (CND)

Este documento contém o passo a passo e os trechos de código exatos para replicar a correção aplicada no robô de Consulta de Certidão Negativa de Débito (`consultar-cnd`).

---

## 1. Contexto do Problema

Dois fatores impediam a leitura e processamento de determinados PDFs gerados pela SEFAZ:
1. **Corrupção de Codificação no `pdf-parse` (Fontes TrueType com CMap 16-bit)**:
   Em PDFs com fontes TrueType embutidas (ex: *CourierHP*), ocorria *byte swap* em caracteres de 16 bits (gerando caracteres CJK) e mapeamento incorreto do caractere `'2'` para sequências como `(\u1100)` ou `\u1100`, corrompendo os números de CPF/CNPJ e valores de identificação.
2. **Layout com pontuação variável nos cabeçalhos**:
   As expressões regulares de extração exigiam obrigatoriamente `:` colado em `NOME:` e `DESPACHO:`. Em certidões onde esses cabeçalhos vinham com sublinhados (`DESPACHO _____`) ou sem pontuação (`NOME CPF-MF`), a captura falhava.

---

## 2. Arquivos Alterados

1. `src/backend/utils/certidaoExtractor.js`
2. `config/profiles.example.json` (e o respectivo `config/profiles.json` do ambiente, se existir)

---

## 3. Alterações no Código

### 3.1. Arquivo: `src/backend/utils/certidaoExtractor.js`

#### Inserção da função de normalização
Adicione a função `normalizarTextoPdf` logo após os `require`:

```javascript
/**
 * Normaliza textos extraídos de PDFs com falhas de mapeamento de fontes (ex: TrueType com CMap 16-bit).
 * Trata o byte swap de UTF-16 BE e glifos corrompidos recorrentes.
 */
function normalizarTextoPdf(texto) {
    if (!texto) return '';
    // Substitui a sequência de escape corrompida do dígito '2' (\u1100 ou (\u1100))
    let s = texto.replace(/\(\u1100\)/g, '2').replace(/\u1100/g, '2');
    let resultado = '';
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        // Corrige caracteres onde o byte alto contém o caractere ASCII imprimível (0x20 a 0x7E)
        if ((code & 0xFF) === 0 && (code >> 8) >= 0x20 && (code >> 8) <= 0x7E) {
            resultado += String.fromCharCode(code >> 8);
        } else {
            resultado += s[i];
        }
    }
    return resultado;
}
```

#### Aplicação no `renderPage`
Dentro de `extrairCertidoes`, localize o loop de itens no `renderPage`:

**Antes:**
```javascript
            for (let item of textContent.items) {
                // Preserva quebras de linha baseadas na posição Y (ajuda na precisão do Regex)
                if (lastY !== item.transform[5] && lastY !== null) {
                    text += '\n';
                }
                text += item.str;
                lastY = item.transform[5];
            }
```

**Depois:**
```javascript
            for (let item of textContent.items) {
                // Preserva quebras de linha baseadas na posição Y (ajuda na precisão do Regex)
                if (lastY !== item.transform[5] && lastY !== null) {
                    text += '\n';
                }
                text += normalizarTextoPdf(item.str);
                lastY = item.transform[5];
            }
```

---

### 3.2. Arquivo: `config/profiles.example.json` (e `config/profiles.json`)

No perfil `"id": "consultar-cnd"`, atualize a seção `mapeamento_colunas.campos`:

**Antes:**
```json
        "campos": {
          "nome": "NOME:(?:CNPJ|CPF-MF)[\\s\\\"\\n,]*([A-ZÀ-Ÿ.\\s&]+?)(?=\\s\\d)",
          "cpf_cnpj": "(\\d{3}\\.\\d{3}\\.\\d{3}\\-\\d{2}|\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}\\-\\d{2})",
          "situacao": "DESPACHO.*?:[\\s\\n\\\"\\,]*(NAO CONSTA DEBITO|POSSUI DEBITO[\\s\\S]*?\\.)"
        }
```

**Depois:**
```json
        "campos": {
          "nome": "NOME:?(?:\\s*(?:CNPJ|CPF-MF))?[\\s\\\"\\n,]*([A-ZÀ-Ÿ.\\s&]+?)(?=\\s*\\d{2,3}[.\\/])",
          "cpf_cnpj": "(\\d{3}\\.\\d{3}\\.\\d{3}\\-\\d{2}|\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}\\-\\d{2})",
          "situacao": "DESPACHO[_\\s:]*([\\s\\n\\\"\\,]*(?:NAO CONSTA DEBITO|POSSUI DEBITO[\\s\\S]*?\\.))"
        }
```

---

## 4. Validação e Teste

Para validar a implementação, execute o script de verificação no terminal:

```bash
node -e "
const fs = require('fs');
const { extrairCertidoes } = require('./src/backend/utils/certidaoExtractor.js');
const profiles = JSON.parse(fs.readFileSync('./config/profiles.example.json', 'utf8'));
const cndProfile = profiles.perfis.find(p => p.id === 'consultar-cnd');

async function test() {
  const res = await extrairCertidoes(['certidao.pdf', 'cnds.pdf'], cndProfile.mapeamento_colunas);
  console.log('Resultado da extração:', JSON.stringify(res, null, 2));
}
test();
"
```

### Resultado Esperado:
- Todas as certidões de ambos os arquivos devem ser categorizadas em `negativa` (ou `positiva`, se houver débitos) com `nome`, `cpf_cnpj` e `situacao` devidamente preenchidos, sem valores nulos ou caracteres corrompidos.
