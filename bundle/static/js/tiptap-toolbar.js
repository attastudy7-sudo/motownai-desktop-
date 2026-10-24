(function () {
  'use strict';

  function _htmlToMarkdown(el) {
    function _conv(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return '';
      var tag = node.tagName.toLowerCase();
      var kids = Array.from(node.childNodes).map(_conv).join('');
      switch (tag) {
        case 'h1': return '\n# ' + kids.trim() + '\n\n';
        case 'h2': return '\n## ' + kids.trim() + '\n\n';
        case 'h3': return '\n### ' + kids.trim() + '\n\n';
        case 'h4': return '\n#### ' + kids.trim() + '\n\n';
        case 'h5': return '\n##### ' + kids.trim() + '\n\n';
        case 'h6': return '\n###### ' + kids.trim() + '\n\n';
        case 'p': return '\n' + kids.trim() + '\n\n';
        case 'br': return '\n';
        case 'strong': case 'b': return '**' + kids.trim() + '**';
        case 'em': case 'i': return '*' + kids.trim() + '*';
        case 'u': return '__' + kids.trim() + '__';
        case 's': case 'del': return '~~' + kids.trim() + '~~';
        case 'code':
          if (node.parentNode && node.parentNode.tagName.toLowerCase() === 'pre') return kids;
          return '`' + kids + '`';
        case 'pre': return '\n```\n' + kids.trim() + '\n```\n\n';
        case 'blockquote': return '\n> ' + kids.trim().replace(/\n/g, '\n> ') + '\n\n';
        case 'hr': return '\n---\n\n';
        case 'a': {
          var href = node.getAttribute('href') || '';
          return '[' + kids.trim() + '](' + href + ')';
        }
        case 'img': {
          var src = node.getAttribute('src') || '';
          var alt = node.getAttribute('alt') || '';
          return '![' + alt + '](' + src + ')';
        }
        case 'ul': return '\n' + kids + '\n';
        case 'ol': return '\n' + kids + '\n';
        case 'li': {
          var parentTag = node.parentNode && node.parentNode.tagName ? node.parentNode.tagName.toLowerCase() : 'ul';
          var idx = parentTag === 'ol' ? (Array.from(node.parentNode.children).indexOf(node) + 1) + '. ' : '- ';
          return idx + kids.trim() + '\n';
        }
        case 'table': {
          var rows = Array.from(node.querySelectorAll('tr'));
          if (!rows.length) return kids;
          var md = '\n';
          rows.forEach(function(row, ri) {
            var cells = Array.from(row.querySelectorAll('th, td'));
            md += '| ' + cells.map(function(c) { return _conv(c).trim().replace(/\|/g, '\\|'); }).join(' | ') + ' |\n';
            if (ri === 0) {
              md += '| ' + cells.map(function() { return '---'; }).join(' | ') + ' |\n';
            }
          });
          return md + '\n';
        }
        case 'div': case 'section': case 'article': return kids;
        case 'mark': return '==' + kids + '==';
        case 'mjx-container': {
          var label = node.getAttribute('aria-label') || node.textContent || '';
          return ' $' + label.trim() + '$ ';
        }
        default: return kids;
      }
    }
    return _conv(el).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  var FONT_OPTIONS = [
    { label: 'Sans Serif',   value: 'sans-serif' },
    { label: 'Serif',        value: 'serif' },
    { label: 'Monospace',    value: 'monospace' },
    { label: 'DM Sans',      value: "'DM Sans', sans-serif" },
    { label: 'Space Grotesk',value: "'Space Grotesk', sans-serif" },
    { label: 'Georgia',      value: 'Georgia, serif' },
    { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
    { label: 'Arial',        value: 'Arial, sans-serif' },
    { label: 'Verdana',      value: 'Verdana, sans-serif' },
    { label: 'Tahoma',       value: 'Tahoma, sans-serif' },
    { label: 'Courier New',  value: "'Courier New', monospace" },
  ].map(function (f) { return { label: f.label, value: f.value, fontFamily: f.value }; });

  window._tiptapToolbar = {
    createToolbar: function () {
      var div = document.createElement('div');
      div.className = 'tiptap-toolbar custom-scrollbar px-4 md:px-6 flex items-center justify-center p-2 transition-all duration-300 translate-y-0 opacity-100 default_cursor_cs';
      div.innerHTML =
        '<div class="group relative inline-flex max-w-full items-center overflow-hidden rounded-lg border backdrop-blur-md border-white/10 bg-[#111111]/30 default_cursor_cs">' +
          '<div class="scrollbar-hide inline-flex w-full flex-nowrap items-center gap-1 overflow-x-auto px-2 py-1 sm:py-0.5 [&>*]:shrink-0 default_cursor_cs">' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Undo (Ctrl+Z)" data-state="closed">' +
              '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-undo2 h-4 w-4 default_pointer_cs"><path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"></path></svg>' +
            '</button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Redo (Ctrl+Shift+Z)" data-state="closed">' +
              '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-redo2 h-4 w-4"><path d="m15 14 5-5-5-5"></path><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"></path></svg>' +
            '</button>' +
            '<div class="h-6 w-px bg-gray-700 default_cursor_cs"></div>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" aria-label="Generate flashcards from notes" data-state="closed" title="Generate flashcards from notes"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M3.604 7.197l7.138 -3.109a0.96 .96 0 0 1 1.27 .527l4.924 11.902a1.004 1.004 0 0 1 -.514 1.304l-7.137 3.109a0.96 .96 0 0 1 -1.271 -.527l-4.924 -11.903a1.005 1.005 0 0 1 .514 -1.304z"></path><path d="M15 4h1a1 1 0 0 1 1 1v3.5"></path><path d="M20 6c.264 .112 .52 .217 .768 .315a1 1 0 0 1 .53 1.311l-2.298 5.374"></path></svg></button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" aria-label="Download as PDF" data-state="closed" title="Download as PDF"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-down h-4 w-4"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M12 18v-6"></path><path d="m9 15 3 3 3-3"></path></svg></button>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<div class="relative font-family-dropdown">' +
              '<button class="flex items-center gap-1 rounded px-2 py-2 text-sm transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs font-trigger default_pointer_cs" style="padding: 0.5rem 3rem;" type="button" aria-label="Font Family"><span class="default_pointer_cs font-family-label">Sans Serif</span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down h-3 w-3"><path d="m6 9 6 6 6-6"></path></svg></button>' +
            '</div>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Bold (Ctrl+B)" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bold h-4 w-4"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"></path></svg></button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Italic (Ctrl+I)" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-italic h-4 w-4"><line x1="19" x2="10" y1="4" y2="4"></line><line x1="14" x2="5" y1="20" y2="20"></line><line x1="15" x2="9" y1="4" y2="20"></line></svg></button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Underline (Ctrl+U)" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-underline h-4 w-4"><path d="M6 4v6a6 6 0 0 0 12 0V4"></path><line x1="4" x2="20" y1="20" y2="20"></line></svg></button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Strikethrough" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-strikethrough h-4 w-4 default_pointer_cs"><path d="M16 4H9a3 3 0 0 0-2.83 4"></path><path d="M14 12a4 4 0 0 1 0 8H6" class="default_pointer_cs"></path><line x1="4" x2="20" y1="12" y2="12"></line></svg></button>' +
            '<div class="h-6 w-px bg-gray-700 default_cursor_cs"></div>' +
            '<div class="relative"><button class="flex items-center gap-1 rounded px-2 py-2 text-sm transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs headings-trigger" type="button" aria-label="Headings"><span>H</span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down h-3 w-3 default_pointer_cs"><path d="m6 9 6 6 6-6"></path></svg></button></div>' +
            '<div class="h-6 w-px bg-gray-700 default_cursor_cs"></div>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Bullet List" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list h-4 w-4"><path d="M3 12h.01"></path><path d="M3 18h.01"></path><path d="M3 6h.01"></path><path d="M8 12h13"></path><path d="M8 18h13" class="default_pointer_cs"></path><path d="M8 6h13"></path></svg></button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Numbered List" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-ordered h-4 w-4"><path d="M10 12h11"></path><path d="M10 18h11"></path><path d="M10 6h11"></path><path d="M4 10h2"></path><path d="M4 6h1v4"></path><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"></path></svg></button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 default_pointer_cs" aria-label="Task List" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-todo h-4 w-4 default_pointer_cs"><rect x="3" y="5" width="6" height="6" rx="1"></rect><path d="m3 17 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path></svg></button>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" aria-label="Quote" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-quote h-4 w-4"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"></path><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"></path></svg></button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" aria-label="Code Block" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-code h-4 w-4"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg></button>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" aria-label="Divider" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-minus h-4 w-4"><path d="M5 12h14"></path></svg></button>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" aria-label="Insert Math (LaTeX)" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sigma h-4 w-4"><path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"></path></svg></button>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<div class="relative color-tool"><button class="flex flex-col items-center gap-0.5 rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 color-trigger" type="button" aria-label="Text Color"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-palette h-4 w-4"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg><div class="h-1 w-5 rounded-full color-indicator" style="background-color: rgb(252, 246, 245);"></div></button></div>' +
            '<div class="relative hl-tool"><button class="flex flex-col items-center gap-0.5 rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 hl-trigger" type="button" aria-label="Highlight"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-highlighter h-4 w-4"><path d="m9 11-6 6v3h9l3-3"></path><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"></path></svg><div class="h-1 w-5 rounded-full hl-indicator" style="background-color: transparent; border: 1px solid rgb(102, 102, 102);"></div></button></div>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<div class="relative"><button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15 align-trigger" type="button" aria-label="Text Alignment"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-align-left h-4 w-4"><path d="M15 12H3"></path><path d="M17 18H3"></path><path d="M21 6H3"></path></svg></button></div>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<div class="relative"><button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="radix-:rb9:" data-state="closed" aria-label="Add Link"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link h-4 w-4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></button></div>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" aria-label="Insert Image" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image h-4 w-4"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg></button>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<button class="tiptap-button rounded p-2 transition-colors table-trigger" data-style="ghost" type="button" aria-label="Insert Table"><svg width="24" height="24" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 5C2 3.34315 3.34315 2 5 2H19C20.6569 2 22 3.34315 22 5V19C22 20.6569 20.6569 22 19 22H5C3.34315 22 2 20.6569 2 19V5ZM4 5C4 4.44772 4.44772 4 5 4H11V8H4V5ZM4 10H11V14H4V10ZM20 14V10H13V14H20ZM13 16H20V19C20 19.5523 19.5523 20 19 20H13V16ZM11 16V20H5C4.44772 20 4 19.5523 4 19V16H11ZM13 8H20V5C20 4.44772 19.5523 4 19 4H13V8Z" fill="currentColor"></path></svg></button>' +
            '<div class="h-6 w-px bg-gray-700"></div>' +
            '<button class="rounded p-2 transition-colors text-gray-300 hover:bg-gray-300/15" aria-label="Print / Save as PDF" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-down h-4 w-4"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M12 18v-6"></path><path d="m9 15 3 3 3-3"></path></svg></button>' +
          '</div>' +
          '<button class="absolute right-0 top-0 z-10 flex h-full w-12 items-center justify-end rounded-r-lg pr-2 transition-opacity duration-200 bg-gradient-to-l from-[#111111] via-[#111111]/80 to-transparent text-gray-200 opacity-100 default_pointer_cs" aria-label="Scroll right"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right h-4 w-4"><path d="m9 18 6-6-6-6"></path></svg></button>' +
        '</div>';
      return div;
    },

    initToolbar: function (wrap) {
      if (!wrap) return;
      var editor = wrap.querySelector('.notes-prosemirror');
      if (!editor) return;

      wrap.addEventListener('click', function (e) {
        var control = e.target.closest('[aria-label]');
        if (!control) return;
        var label = (control.getAttribute('aria-label') || '').toLowerCase();

        switch (true) {
          case /undo/.test(label):
            editor.focus();
            document.execCommand('undo');
            break;
          case /redo/.test(label):
            editor.focus();
            document.execCommand('redo');
            break;
          case /bold/.test(label): editor.focus(); document.execCommand('bold'); break;
          case /italic/.test(label): editor.focus(); document.execCommand('italic'); break;
          case /underline/.test(label): editor.focus(); document.execCommand('underline'); break;
          case /strikethrough/.test(label): editor.focus(); document.execCommand('strikeThrough'); break;
          case /bullet list/.test(label): editor.focus(); document.execCommand('insertUnorderedList'); break;
          case /numbered list/.test(label): editor.focus(); document.execCommand('insertOrderedList'); break;
          case /task list/.test(label): editor.focus(); document.execCommand('insertUnorderedList'); break;
          case /quote/.test(label): editor.focus(); document.execCommand('formatBlock', false, 'blockquote'); break;
          case /code block/.test(label): editor.focus(); document.execCommand('formatBlock', false, 'pre'); break;
          case /divider/.test(label): editor.focus(); document.execCommand('insertHorizontalRule'); break;
          case /insert math/.test(label): {
            var latex = prompt('Enter LaTeX:');
            if (latex) { editor.focus(); document.execCommand('insertText', false, '$$' + latex + '$$'); }
            break;
          }
          case /add link/.test(label): {
            var url = prompt('Enter URL to link to:');
            if (url) { editor.focus(); document.execCommand('createLink', false, url); }
            break;
          }
          case /insert image/.test(label): {
            var url = prompt('Enter image URL:');
            if (url) { editor.focus(); document.execCommand('insertImage', false, url); }
            break;
          }
          case /print \/ save as pdf/.test(label): {
            var notesHtml = document.querySelector('.notes-prosemirror')?.innerHTML || '';
            var w = window.open('', '_blank');
            if (!w) break;
            w.document.write(
              '<!DOCTYPE html><html><head><meta charset="utf-8">' +
              '<title>Notes</title>' +
              '<style>' +
              'body{font-family:Georgia,serif;font-size:12pt;line-height:1.6;color:#1a1a1a;max-width:800px;margin:40px auto;padding:0 20px}' +
              'h1{font-size:20pt;margin:24px 0 8px}' +
              'h2{font-size:16pt;margin:20px 0 6px}' +
              'h3{font-size:14pt;margin:16px 0 4px}' +
              'p,li{font-size:12pt}' +
              'ul,ol{padding-left:24px}' +
              'blockquote{border-left:3px solid #ccc;padding-left:12px;color:#555;font-style:italic;margin:12px 0}' +
              'pre{background:#f5f5f5;padding:12px;border-radius:4px;font-size:10pt;overflow-x:auto}' +
              'code{background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:10pt}' +
              'table{border-collapse:collapse;width:100%;margin:12px 0}' +
              'th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}' +
              'img{max-width:100%}' +
              '@media print{body{margin:0}}' +
              '</style></head><body>' +
              notesHtml +
              '</body></html>'
            );
            w.document.close();
            setTimeout(function () { w.focus(); w.print(); w.close(); }, 500);
            break;
          }
          case /generate flashcards from notes/.test(label): {
            var notesEl = document.querySelector('.notes-prosemirror');
            if (!notesEl) break;
            var notesText = (notesEl.innerText || '').trim();
            if (notesText.length < 20) {
              if (typeof showToast === 'function') showToast('Write more notes before generating flashcards.', 'info');
              break;
            }
            var packId = window.PACK_ID || 0;
            if (typeof showToast === 'function') showToast('Generating flashcards from notes\u2026', 'info');
            fetch('/api/notes/make-card-for-pack', {
              method: 'POST',
              headers: { 'X-CSRFToken': (function() { var m = document.querySelector('meta[name="csrf-token"]'); return m ? m.getAttribute('content') : ''; })(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: notesText, pack_id: packId }),
            }).then(function(r) { return r.json(); }).then(function(data) {
              if (data.ok && Array.isArray(data.cards) && data.cards.length) {
                if (typeof showToast === 'function') showToast(data.cards.length + ' flashcards created from notes!', 'info');
                if (window._fcCards && Array.isArray(window._fcCards)) {
                  var newIndex = window._fcCards.length;
                  var seenKeys = {};
                  window._fcCards.forEach(function (c) {
                    var k = (window._dedupKey || function(){ return ''; })(c, 'flashcards');
                    if (k) seenKeys[k] = true;
                  });
                  data.cards.forEach(function (c) {
                    var k = (window._dedupKey || function(){ return ''; })(c, 'flashcards');
                    if (k && seenKeys[k]) return;
                    if (k) seenKeys[k] = true;
                    window._fcCards.push({ front: c.front, back: c.back });
                  });
                  if (typeof window._fcInitDeck === 'function') window._fcInitDeck(window._fcCards);
                  if (typeof window._fcLoad === 'function') window._fcLoad(newIndex);
                }
              } else {
                if (typeof showToast === 'function') showToast('Error: ' + (data.error || 'Could not generate flashcards'), 'info');
              }
            }).catch(function() {
              if (typeof showToast === 'function') showToast('Could not generate flashcards', 'info');
            });
            break;
          }
          case /download as pdf/.test(label): {
            var notesHtml = document.querySelector('.notes-prosemirror')?.innerHTML || '';
            var w = window.open('', '_blank');
            if (!w) break;
            w.document.write(
              '<!DOCTYPE html><html><head><meta charset="utf-8">' +
              '<title>Notes</title>' +
              '<style>' +
              'body{font-family:Georgia,serif;font-size:12pt;line-height:1.6;color:#1a1a1a;max-width:800px;margin:40px auto;padding:0 20px}' +
              'h1{font-size:20pt;margin:24px 0 8px}' +
              'h2{font-size:16pt;margin:20px 0 6px}' +
              'h3{font-size:14pt;margin:16px 0 4px}' +
              'p,li{font-size:12pt}' +
              'ul,ol{padding-left:24px}' +
              'blockquote{border-left:3px solid #ccc;padding-left:12px;color:#555;font-style:italic;margin:12px 0}' +
              'pre{background:#f5f5f5;padding:12px;border-radius:4px;font-size:10pt;overflow-x:auto}' +
              'code{background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:10pt}' +
              'table{border-collapse:collapse;width:100%;margin:12px 0}' +
              'th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}' +
              'img{max-width:100%}' +
              '@media print{body{margin:0}}' +
              '</style></head><body>' +
              notesHtml +
              '</body></html>'
            );
            w.document.close();
            setTimeout(function () { w.focus(); w.print(); w.close(); }, 500);
            break;
          }
          default:
            return;
        }
        editor.focus();
        e.preventDefault();
      });

      var fontTrigger = wrap.querySelector('.font-trigger');
      var fontLabel = wrap.querySelector('.font-family-label');

      function _fontSelect(value) {
        editor.focus();
        var sel = window.getSelection();
        var hasSelection = sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed;
        if (hasSelection) {
          document.execCommand('fontName', false, value);
        } else {
          editor.style.fontFamily = value;
          try { localStorage.setItem('notes-font-family', value); } catch(_) {}
        }
        for (var fi = 0; fi < FONT_OPTIONS.length; fi++) {
          if (FONT_OPTIONS[fi].value === value) {
            if (fontLabel) fontLabel.textContent = FONT_OPTIONS[fi].label;
            break;
          }
        }
      }

      if (fontTrigger) {
        fontTrigger.addEventListener('click', function (e) {
          e.stopPropagation();
          e.preventDefault();
          showDropdown(fontTrigger, FONT_OPTIONS, _fontSelect);
        });
      }

      try {
        var savedFont = localStorage.getItem('notes-font-family');
        if (savedFont) {
          editor.style.fontFamily = savedFont;
          if (fontLabel) {
            for (var fi = 0; fi < FONT_OPTIONS.length; fi++) {
              if (FONT_OPTIONS[fi].value === savedFont) {
                fontLabel.textContent = FONT_OPTIONS[fi].label;
                break;
              }
            }
          }
        }
      } catch(_) {}

      function showDropdown(trigger, items, onSelect) {
        var existing = document.querySelector('.tool-dropdown-menu');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        var menu = document.createElement('div');
        menu.className = 'tool-dropdown-menu';
        menu.style.cssText = 'position:fixed;z-index:9999;background: var(--bg-card);border:1px solid var(--border-hover);border-radius:8px;padding:4px;min-width:150px;box-shadow:0 10px 40px rgba(0,0,0,0.4);';
        items.forEach(function (item) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = item.label;
          btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;border:none;border-radius:6px;background:transparent;color:var(--text-primary);font-size:0.85rem;cursor:pointer;';
          if (item.fontSize) btn.style.fontSize = item.fontSize;
          if (item.fontWeight) btn.style.fontWeight = item.fontWeight;
          if (item.fontFamily) btn.style.fontFamily = item.fontFamily;
          btn.addEventListener('mouseenter', function () { btn.style.background = 'rgba(255,255,255,0.08)'; });
          btn.addEventListener('mouseleave', function () { btn.style.background = 'transparent'; });
          btn.addEventListener('click', function (e) { e.stopPropagation(); onSelect(item.value); menu.style.display = 'none'; if (menu.parentNode) menu.parentNode.removeChild(menu); });
          menu.appendChild(btn);
        });
        var rect = trigger.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 4) + 'px';
        document.body.appendChild(menu);
        setTimeout(function () {
          document.addEventListener('click', function close(e) {
            if (!menu.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
              menu.style.display = 'none';
              if (menu.parentNode) menu.parentNode.removeChild(menu);
              document.removeEventListener('click', close);
            }
          });
        }, 0);
      }

      function showColorDropdown(trigger, colors, onSelect) {
        var existing = document.querySelector('.tool-dropdown-menu');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        var menu = document.createElement('div');
        menu.className = 'tool-dropdown-menu';
        menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border-hover);border-radius:8px;padding:8px;display:flex;flex-wrap:wrap;gap:6px;width:132px;box-shadow:0 10px 40px rgba(0,0,0,0.4);';
        colors.forEach(function (c) {
          var sw = document.createElement('button');
          sw.type = 'button';
          sw.title = c.label;
          sw.style.cssText = 'width:24px;height:24px;border-radius:50%;border:2px solid rgba(255,255,255,0.25);cursor:pointer;background:' + c.value + ';';
          sw.addEventListener('click', function (e) { e.stopPropagation(); onSelect(c.value); if (menu.parentNode) menu.parentNode.removeChild(menu); });
          menu.appendChild(sw);
        });
        var rect = trigger.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 4) + 'px';
        document.body.appendChild(menu);
        setTimeout(function () {
          document.addEventListener('click', function close(e) {
            if (!menu.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
              if (menu.parentNode) menu.parentNode.removeChild(menu);
              document.removeEventListener('click', close);
            }
          });
        }, 0);
      }

      var hTrigger = wrap.querySelector('.headings-trigger');
      if (hTrigger) {
        hTrigger.addEventListener('click', function (e) {
          e.stopPropagation(); e.preventDefault();
          showDropdown(hTrigger, [
            { label: 'Paragraph', value: 'p' },
            { label: 'Heading 1', value: 'h1', fontSize: '1.2rem', fontWeight: '700' },
            { label: 'Heading 2', value: 'h2', fontSize: '1.05rem', fontWeight: '700' },
            { label: 'Heading 3', value: 'h3', fontSize: '0.95rem', fontWeight: '600' },
            { label: 'Heading 4', value: 'h4', fontSize: '0.85rem', fontWeight: '600' },
          ], function (tag) { editor.focus(); document.execCommand('formatBlock', false, tag); });
        });
      }

      var colTrigger = wrap.querySelector('.color-trigger');
      if (colTrigger) {
        var TEXT_COLORS = [
          { label: 'Black', value: '#1a1a1a' }, { label: 'Red', value: '#e03131' },
          { label: 'Orange', value: '#e8590c' }, { label: 'Yellow', value: '#f0b400' },
          { label: 'Green', value: '#2f9e44' }, { label: 'Blue', value: '#1971c2' },
          { label: 'Purple', value: '#7048e8' }, { label: 'Gray', value: '#868e96' },
        ];
        colTrigger.addEventListener('click', function (e) {
          e.stopPropagation(); e.preventDefault();
          showColorDropdown(colTrigger, TEXT_COLORS, function (value) {
            editor.focus(); document.execCommand('foreColor', false, value);
            var ind = wrap.querySelector('.color-indicator');
            if (ind) ind.style.backgroundColor = value;
          });
        });
      }

      var hlTrigger = wrap.querySelector('.hl-trigger');
      if (hlTrigger) {
        var HIGHLIGHT_COLORS = [
          { label: 'Yellow', value: '#fff3a3' }, { label: 'Green', value: '#b9f6ca' },
          { label: 'Pink', value: '#ffcdd2' }, { label: 'Blue', value: '#bbdefb' },
          { label: 'Orange', value: '#ffe0b2' }, { label: 'Purple', value: '#e1bee7' },
        ];
        hlTrigger.addEventListener('click', function (e) {
          e.stopPropagation(); e.preventDefault();
          showColorDropdown(hlTrigger, HIGHLIGHT_COLORS, function (value) {
            editor.focus(); document.execCommand('hiliteColor', false, value);
            var ind = wrap.querySelector('.hl-indicator');
            if (ind) { ind.style.backgroundColor = value; ind.style.borderColor = value; }
          });
        });
      }

      var alTrigger = wrap.querySelector('.align-trigger');
      if (alTrigger) {
        alTrigger.addEventListener('click', function (e) {
          e.stopPropagation(); e.preventDefault();
          showDropdown(alTrigger, [
            { label: 'Align Left', value: 'justifyLeft' },
            { label: 'Align Center', value: 'justifyCenter' },
            { label: 'Align Right', value: 'justifyRight' },
            { label: 'Justify', value: 'justifyFull' },
          ], function (cmd) { editor.focus(); document.execCommand(cmd, false, null); });
        });
      }

      var scrollRightBtn = wrap.querySelector('[aria-label="Scroll right"]');
      var scrollTrack = wrap.querySelector('.scrollbar-hide');
      if (scrollRightBtn && scrollTrack) {
        scrollRightBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          e.preventDefault();
          scrollTrack.scrollBy({ left: 120, behavior: 'smooth' });
        });
        scrollTrack.addEventListener('scroll', function () {
          var atEnd = scrollTrack.scrollLeft + scrollTrack.clientWidth >= scrollTrack.scrollWidth - 4;
          scrollRightBtn.style.opacity = atEnd ? '0' : '1';
          scrollRightBtn.style.pointerEvents = atEnd ? 'none' : '';
        });
      }

      var tblTrigger = wrap.querySelector('.table-trigger');
      if (tblTrigger) {
        tblTrigger.addEventListener('click', function (e) {
          e.stopPropagation(); e.preventDefault();
          var existing = document.querySelector('.tool-dropdown-menu');
          if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
          var menu = document.createElement('div');
          menu.className = 'tool-dropdown-menu';
          menu.style.cssText = 'position:fixed;z-index:9999;background: var(--bg-card);border:1px solid var(--border-hover);border-radius:8px;padding:8px;box-shadow:0 10px 40px rgba(0,0,0,0.4);';
          var label = document.createElement('div');
          label.style.cssText = 'font-size:0.7rem;color:rgba(255,255,255,0.4);text-align:center;margin-bottom:6px;';
          label.textContent = '1x1';
          menu.appendChild(label);
          var grid = document.createElement('div');
          grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,24px);gap:2px;';
          var ROWS = 6, COLS = 6;
          var cells = [];
          for (var r = 0; r < ROWS; r++) {
            for (var c = 0; c < COLS; c++) {
              (function (row, col) {
                var cell = document.createElement('div');
                cell.style.cssText = 'width:24px;height:20px;border:1px solid rgba(255,255,255,0.15);border-radius:2px;cursor:pointer;background:transparent;';
                cell.addEventListener('mouseenter', function () {
                  cells.forEach(function (d, i) {
                    var rr = Math.floor(i / COLS), cc = i % COLS;
                    d.style.background = (rr <= row && cc <= col) ? 'rgba(59,130,246,0.3)' : 'transparent';
                    d.style.borderColor = (rr <= row && cc <= col) ? 'rgba(59,130,246,0.6)' : 'rgba(255,255,255,0.15)';
                  });
                  label.textContent = (row + 1) + 'x' + (col + 1);
                });
                cell.addEventListener('click', function () {
                  editor.focus();
                  var html = '<table style="border-collapse:collapse;width:100%;margin:8px 0;"><tbody>';
                  for (var i = 0; i < row + 1; i++) {
                    html += '<tr>';
                    for (var j = 0; j < col + 1; j++) html += '<td style="border:1px solid var(--sr-border,#555);padding:6px 10px;">&nbsp;</td>';
                    html += '</tr>';
                  }
                  html += '</tbody></table>';
                  document.execCommand('insertHTML', false, html);
                  if (menu.parentNode) menu.parentNode.removeChild(menu);
                });
                grid.appendChild(cell);
                cells.push(cell);
              })(r, c);
            }
          }
          menu.appendChild(grid);
          var rect = tblTrigger.getBoundingClientRect();
          menu.style.left = rect.left + 'px';
          menu.style.top = (rect.bottom + 4) + 'px';
          document.body.appendChild(menu);
          setTimeout(function () {
            document.addEventListener('click', function close(e) {
              if (!menu.contains(e.target) && e.target !== tblTrigger && !tblTrigger.contains(e.target)) {
                if (menu.parentNode) menu.parentNode.removeChild(menu);
                document.removeEventListener('click', close);
              }
            });
          }, 0);
        });
      }

      editor.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey) {
          if (e.key === 'b') { document.execCommand('bold'); e.preventDefault(); }
          if (e.key === 'i') { document.execCommand('italic'); e.preventDefault(); }
          if (e.key === 'u') { document.execCommand('underline'); e.preventDefault(); }
          if (e.shiftKey && e.key === 'z') { document.execCommand('redo'); e.preventDefault(); }
        }
      });
    }
  };
})();
