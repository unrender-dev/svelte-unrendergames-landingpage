const fs = require('fs');

let html = fs.readFileSync('topdown.html', 'utf8');

// 1. Fix the \n literal issue
html = html.replace(/\\n/g, '\n');

// 2. Adjust updateUI text sizing replacements since they were hardcoded with text-2xl etc.
html = html.replace(/text-xl md:text-2xl/g, 'text-xs md:text-sm');
html = html.replace(/text-2xl md:text-3xl/g, 'text-sm md:text-base');
html = html.replace(/text-2xl/g, 'text-xs'); // mostly in JS injection
html = html.replace(/text-xl/g, 'text-xs');
html = html.replace(/text-3xl/g, 'text-base');
html = html.replace(/text-lg md:text-xl/g, 'text-[10px] md:text-xs');

// 3. Font
html = html.replace('family=VT323', 'family=Press+Start+2P');
html = html.replace("'VT323', monospace", "'Press Start 2P', cursive");
html = html.replace('letter-spacing: 1px;', 'letter-spacing: 0px; line-height: 1.2;');

// 4. Update the watch HTML
const watchStart = html.indexOf('<!-- WATCH & TEMP (BOTTOM LEFT) -->');
const watchEnd = html.indexOf('<!-- TOOLS & TOGGLES (BOTTOM RIGHT) -->');

if (watchStart > -1 && watchEnd > -1) {
    const watchReplacement = `    <!-- DIGITAL WATCH & TEMP (BOTTOM LEFT) -->
    <div class="fixed bottom-4 left-4 z-10 flex flex-col pointer-events-none drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] scale-75 md:scale-100 origin-bottom-left">
        <!-- Watch Strap Top -->
        <div class="w-16 h-4 bg-zinc-800 mx-auto border-x-4 border-t-2 border-zinc-900 rounded-t-sm"></div>
        <!-- Watch Body -->
        <div class="relative bg-zinc-700 border-4 border-zinc-500 rounded-xl p-3 shadow-[inset_0_-4px_0_rgba(0,0,0,0.5)] flex flex-col items-center justify-center min-w-[160px]">
            <!-- Watch Screen -->
            <div class="bg-[#879982] w-full py-3 px-2 rounded border-2 border-gray-900 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] flex flex-col items-center relative overflow-hidden">
                <div class="absolute inset-0 opacity-10 pointer-events-none" style="background-image: repeating-linear-gradient(0deg, transparent, transparent 1px, #000 1px, #000 2px);"></div>
                <span class="text-[8px] text-gray-800 tracking-widest uppercase mb-1 font-bold font-sans">SURVIVAL-G</span>
                <span id="txt-time" class="text-black text-sm pixel-text my-1" style="text-shadow: none;">12:00 PM</span>
                <div class="flex flex-row w-full justify-between items-center mt-2 px-1 border-t border-gray-800/20 pt-1">
                    <span class="text-[8px] text-gray-800 font-bold uppercase font-sans">TEMP</span>
                    <span id="txt-temp" class="text-[10px] text-black pixel-text font-bold" style="text-shadow: none;">37.0°C</span>
                </div>
            </div>
            <!-- Watch buttons details -->
            <div class="absolute -right-2 top-1/2 transform -translate-y-1/2 w-2 h-6 bg-zinc-400 border border-zinc-800 rounded-r-md"></div>
            <div class="absolute -left-2 top-1/2 transform -translate-y-1/2 w-2 h-6 bg-zinc-400 border border-zinc-800 rounded-l-md"></div>
        </div>
        <!-- Watch Strap Bottom -->
        <div class="w-16 h-6 bg-zinc-800 mx-auto border-x-4 border-b-2 border-zinc-900 rounded-b-sm"></div>
    </div>

`;
    html = html.substring(0, watchStart) + watchReplacement + html.substring(watchEnd);
}

// 5. Fix JS injected styles for the watch/temp (remove text-white and text colors since background is greenish now)
html = html.replace('let tColor = \\'text-white\\';', 'let tColor = \\'text-black\\';'); 
html = html.replace('let tColor = \\'text-black\\';\\n            let tIconColor = \\'text-gray-300\\';\\n            if (sv.temp > 39) { tColor = \\'text-red-500\\'; tIconColor = \\'text-red-500\\'; }\\n            else if (sv.temp < 35) { tColor = \\'text-blue-400\\'; tIconColor = \\'text-blue-400\\'; }\\n\\n            document.getElementById(\\'txt-temp\\').className = \\'text-2xl font-bold pixel-text \\' + tColor;\\n            document.getElementById(\\'txt-temp\\').previousElementSibling.className = \\'fa-solid fa-temperature-half text-xl drop-shadow-[0_0_5px_currentColor] \\' + tIconColor;\\n', 
`let tColor = 'text-black';
            if (sv.temp > 39) { tColor = 'text-red-800'; }
            else if (sv.temp < 35) { tColor = 'text-blue-800'; }
            document.getElementById('txt-temp').className = 'text-[10px] font-bold pixel-text ' + tColor;
`);

fs.writeFileSync('topdown.html', html);
console.log('Fixed styling and synthetic errors.');
