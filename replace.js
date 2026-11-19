import fs from 'fs';

function replaceBlock(filePath, startMarker, endMarker, replacement, replaceScriptContent) {
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace script 
    content = content.replace('import { contactModalState } from "./modalStore.js";', replaceScriptContent);

    let lines = content.split('\n');
    let startLine = -1;
    let endLine = -1;
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
        if (startLine === -1 && lines[i].includes(startMarker)) {
            startLine = i;
        }

        if (startLine !== -1 && i >= startLine) {
            let line = lines[i];
            let openDivs = (line.match(/<div/g) || []).length;
            let closeDivs = (line.match(/<\/div>/g) || []).length;
            braceCount += openDivs - closeDivs;

            if (braceCount === 0 && i >= startLine) { // Fix: braceCount reaches 0 explicitly at the close div
                endLine = i;
                break;
            }
        }
    }

    if (startLine !== -1 && endLine !== -1) {
        lines.splice(startLine, endLine - startLine + 1, replacement);
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        console.log(`Replaced block in ${filePath}`);
    } else {
        console.log(`Failed to find block in ${filePath} / Start: ${startLine} End: ${endLine}`);
    }
}

const fScript = `import { contactModalState } from "./modalStore.js";\n  import FeatureGrid from "./FeatureGrid.svelte";\n\n  const features = [\n    {\n      icon: "fas fa-globe",\n      title: "Mundos Virtuais",\n      shortDesc: "Crie réplicas e experiências de marca.",\n      longDesc: "Utilizamos a UEFN para projetar e publicar ilhas super realistas e imersivas conectando sua marca com o público.",\n      images: ["/images/fortnite_banner1.jpg"]\n    },\n    {\n      icon: "fas fa-gamepad",\n      title: "Gamificação",\n      shortDesc: "Engaje e fidelize com missões e eventos.",\n      longDesc: "Adicionamos mecânicas de gameplay viciantes e missões diárias com recompensas para reter os jogadores.",\n      images: ["/images/hellmans.png"]\n    },\n    {\n      icon: "fas fa-chart-bar",\n      title: "Retorno Real",\n      shortDesc: "Tráfego, cupons e métricas de negócio.",\n      longDesc: "Conecte o virtual e o físico oferecendo descontos via cupons no Fortnite convertendo engajamento em vendas.",\n      images: ["/images/fortnite_banner1.jpg"]\n    },\n    {\n      icon: "fas fa-users",\n      title: "Comunidade",\n      shortDesc: "Experiências validadas pela comunidade.",\n      longDesc: "Trabalhamos com criadores de conteúdo do Fortnite para que sua experiência ganhe tração orgânica.",\n      images: ["/images/hellmans.png", "/images/fortnite_banner1.jpg"]\n    }\n  ];`;

replaceBlock(
    'src/lib/FortnitePage.svelte',
    '<div class="grid grid-cols-2 gap-3 md:gap-4 lg:gap-6">',
    '',
    '          <FeatureGrid {features} hoverBgClass="hover:bg-[#1e1b4b] focus:bg-[#1e1b4b]" gapClass="gap-3 md:gap-4 lg:gap-6" />',
    fScript
);

const rScript = `import { contactModalState } from "./modalStore.js";\n  import FeatureGrid from "./FeatureGrid.svelte";\n\n  const features = [\n    {\n      icon: "fas fa-globe",\n      title: "Locais, Ambientes e Eventos",\n      shortDesc: "Traga o mundo real para o metaverso.",\n      longDesc: "Criamos as melhores réplicas de locais reais e organizamos eventos virtuais imersivos.",\n      images: ["/images/roblox_banner1.jpg", "/images/roblox_banner2.jpg"]\n    },\n    {\n      icon: "fas fa-gamepad",\n      title: "Jogos",\n      shortDesc: "Obbys, Tycoons e RPGs viciantes.",\n      longDesc: "Desenvolvemos jogos engajadores desenhados para máxima retenção e monetização no Roblox.",\n      images: ["/images/roblox_banner2.jpg"]\n    },\n    {\n      icon: "fas fa-chart-bar",\n      title: "Métricas",\n      shortDesc: "Dados precisos de visitas e retenção.",\n      longDesc: "Painéis analytics e insights sobre comportamento dos jogadores para maximizar o ROI na plataforma.",\n      images: ["/images/roblox_banner1.jpg"]\n    },\n    {\n      icon: "fas fa-users",\n      title: "Comunidade",\n      shortDesc: "Construa uma comunidade leal com UGC.",\n      longDesc: "Crie e distribua itens UGC exclusivos da sua marca, aumentando o reconhecimento visual.",\n      images: ["/images/bis_roblox.jpg", "/images/roblox_banner1.jpg"]\n    }\n  ];`;

replaceBlock(
    'src/lib/RobloxPage.svelte',
    '<div class="grid grid-cols-2 gap-2 md:gap-3">',
    '',
    '          <FeatureGrid {features} hoverBgClass="hover:bg-[#0f172a] focus:bg-[#0f172a]" gapClass="gap-2 md:gap-3" />',
    rScript
);
