class AngularHelper {
    constructor(page) {
        this.page = page;
    }

    async waitForAngularReady(options = {}) {
        const {
            timeout = 15000,
            spinnerSelector = 'ngx-spinner',
            networkIdleTime = 500,
            debug = false
        } = options;

        if (debug) console.log('[AngularHelper] Aguardando estabilidade...');

        // 1. Espera spinner sumir (se existir)
        await this._waitForSpinner(spinnerSelector, timeout, debug);

        // 2. Espera rede estabilizar
        await this._waitForNetworkIdle(networkIdleTime, timeout, debug);

        // 3. Espera DOM estabilizar
        await this._waitForDOMStable(timeout, debug);

        if (debug) console.log('[AngularHelper] Página estável ✅');
    }

    async clickWhenReady(selector, options = {}) {
        const { timeout = 15000, debug = false } = options;

        if (debug) console.log(`[AngularHelper] Esperando elemento: ${selector}`);

        await this.page.waitForSelector(selector, {
            visible: true,
            timeout
        });

        await this.waitForAngularReady({ timeout, debug });

        await this.page.click(selector);

        if (debug) console.log(`[AngularHelper] Clique realizado em: ${selector}`);
    }

    async typeWhenReady(selector, text, options = {}) {
        const { timeout = 15000, debug = false } = options;

        await this.page.waitForSelector(selector, {
            visible: true,
            timeout
        });

        await this.waitForAngularReady({ timeout, debug });

        await this.page.click(selector, { clickCount: 3 });
        await this.page.type(selector, text);
    }

    // =========================
    // MÉTODOS INTERNOS
    // =========================

    async _waitForSpinner(selector, timeout, debug) {
        try {
            await this.page.waitForFunction((sel) => {
                const el = document.querySelector(sel);
                if (!el) return true;

                const style = window.getComputedStyle(el);

                return (
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.opacity === '0'
                );
            }, { timeout }, selector);

            if (debug) console.log('[AngularHelper] Spinner invisível');
        } catch {
            if (debug) console.log('[AngularHelper] Spinner não encontrado (ok)');
        }
    }

    async _waitForNetworkIdle(idleTime, timeout, debug) {
        try {
            await this.page.waitForNetworkIdle({
                idleTime,
                timeout
            });

            if (debug) console.log('[AngularHelper] Rede estável');
        } catch {
            if (debug) console.log('[AngularHelper] Timeout rede (seguindo)');
        }
    }

    async _waitForDOMStable(timeout, debug) {
        await this.page.waitForFunction(() => {
            return new Promise(resolve => {
                let lastMutation = Date.now();

                const observer = new MutationObserver(() => {
                    lastMutation = Date.now();
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true
                });

                const check = () => {
                    if (Date.now() - lastMutation > 500) {
                        observer.disconnect();
                        resolve(true);
                    } else {
                        requestAnimationFrame(check);
                    }
                };

                check();
            });
        }, { timeout });

        if (debug) console.log('[AngularHelper] DOM estável');
    }
}

module.exports = AngularHelper;