/* Ask Moto — admin AI helper. Posts to /admin/ai-assist; drafts can be
   inserted straight into the email composer when it is on the page. */
window.MotoAssist = (function () {
    var history = [];
    var endpoint = window.MOTO_ENDPOINT || '';
    var url = window.MOTO_ASSIST_URL || '/admin/ai-assist';

    function esc(s) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(s));
        return div.innerHTML;
    }

    function addMsg(text, who, draft) {
        var box = document.getElementById('motoMsgs');
        var el = document.createElement('div');
        el.className = 'moto-msg moto-msg--' + who;
        el.innerHTML = esc(text);
        if (draft) {
            var btn = document.createElement('button');
            btn.className = 'adm-btn adm-btn--primary adm-btn--sm moto-insert';
            var hasComposer = !!document.querySelector('textarea[name="message"]');
            btn.textContent = hasComposer ? 'Insert into composer' : 'Copy draft';
            btn.onclick = function () { insertDraft(draft, hasComposer); };
            el.appendChild(document.createElement('br'));
            el.appendChild(btn);
        }
        box.appendChild(el);
        box.scrollTop = box.scrollHeight;
    }

    function insertDraft(draft, intoComposer) {
        if (intoComposer) {
            var set = function (name, val) {
                var f = document.querySelector('[name="' + name + '"]');
                if (f && val) f.value = val;
            };
            set('subject', draft.subject);
            set('message', draft.message);
            set('cta_text', draft.cta_text);
            set('cta_url', draft.cta_url);
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(
                'SUBJECT: ' + draft.subject + '\n\n' + draft.message);
        }
    }

    function pageState() {
        // Email tab: share the live composer draft so summaries/drafts fit.
        var state = {};
        var subject = document.querySelector('input[name="subject"]');
        var message = document.querySelector('textarea[name="message"]');
        if (subject || message) {
            state.subject = subject ? subject.value.slice(0, 1200) : '';
            state.message = message ? message.value.slice(0, 1200) : '';
            var mode = document.getElementById('sendToInput');
            if (mode && mode.value === 'selected') {
                state.recipient_count = document.querySelectorAll('.user-checkbox:checked').length;
            }
        }
        return state;
    }

    function ask(text) {
        text = (text || '').trim();
        if (!text) return;
        toggle(true);
        addMsg(text, 'user');
        var input = document.getElementById('motoInput');
        if (input) input.value = '';
        var csrf = document.querySelector('input[name="csrf_token"]');
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf ? csrf.value : ''
            },
            body: JSON.stringify({
                message: text, endpoint: endpoint,
                state: pageState(), history: history.slice(-6)
            })
        })
            .then(function (r) { return r.json().then(function (j) { return {status: r.status, body: j}; }); })
            .then(function (res) {
                if (res.status !== 200) {
                    addMsg((res.body && res.body.error) || 'Something went wrong.', 'moto');
                    return;
                }
                history.push({role: 'user', content: text});
                history.push({role: 'assistant', content: res.body.reply});
                addMsg(res.body.reply, 'moto', res.body.draft);
            })
            .catch(function () { addMsg('Could not reach Moto. Try again.', 'moto'); });
    }

    function toggle(open) {
        var panel = document.getElementById('motoPanel');
        var willOpen = (open === undefined) ? panel.hidden : open;
        panel.hidden = !willOpen;
        if (willOpen) {
            var input = document.getElementById('motoInput');
            if (input) input.focus();
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var fab = document.getElementById('motoFab');
        if (fab) fab.addEventListener('click', function () { toggle(); });
        var form = document.getElementById('motoForm');
        if (form) form.addEventListener('submit', function (e) {
            e.preventDefault();
            ask(document.getElementById('motoInput').value);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') toggle(false);
        });
    });

    return {ask: ask, toggle: toggle};
})();
