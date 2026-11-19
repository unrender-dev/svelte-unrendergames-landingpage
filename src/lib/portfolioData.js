export const gameProjects = [
    {
        name: "DEADLY BITEZ",
        description: "Jogo",
        longDescription: "Survival hardcore multiplayer de zumbis rodando nativamente no navegador (Three.js/Svelte), com suporte dinâmico a visões isométrica, TPS e FPS. A experiência foca em mecânicas imersivas de sobrevivência.",
        image: null,
        images: [],
        tags: ["Jogo"],
        technologies: [],
        year: "2024",
        links: [
            { icon: "fas fa-play", platform: "demo", url: "https://bitez.unrender.games" }
        ]
    },
    {
        name: "Enigma dos Sinais",
        description: "Jogo educacional de realidade virtual que mistura puzzle com suspense para ensinar Libras e linguagem de Sinais",
        longDescription: "Jogo educacional de realidade virtual que mistura puzzle com suspense para ensinar Libras e linguagem de Sinais",
        image: "/images/realidadevirtual.mp4",
        images: [],
        tags: ["VR", "Educacional", "Libras"],
        technologies: [],
        year: "2024",
        links: [
            { icon: "fas fa-play", platform: "demo", url: "/vr" }
        ]
    }
];

export const models3D = [
    { name: "Low Poly Racoon", path: "/models/3dmodel/low-poly_racoon.glb", thumb: null },
    { name: "Low Poly Car", path: "/models/3dmodel/lowpoly_car.glb", thumb: null },
    { name: "Shuba Duck", path: "/models/3dmodel/shuba_duck.glb", thumb: null },
    { name: "Gaming Chair", path: "/models/3dmodel/gaming_chair.glb", thumb: null },
    { name: "Macbook", path: "/models/3dmodel/macbook.glb", thumb: null },
    { name: "Modern Home", path: "/models/3dmodel/modern_home.glb", thumb: null },
    { name: "Modern House", path: "/models/3dmodel/modern_house.glb", thumb: null },
    { name: "Low Poly Rabbit", path: "/models/3dmodel/low_poly_rabbit.glb", thumb: null },
    { name: "Scaramouche", path: "/models/3dmodel/scaramouche_the_merciless.glb", thumb: null },
    { name: "Cerrado Tree", path: "/models/3dmodel/cerrado_tree.glb", thumb: null }
];

export const avProjects = [
    { name: "Fullbody MoCap", description: "Captura de movimento corporal completo para animações realistas.", icon: "fas fa-running", color: "#ff6b6b", tags: ["Motion Capture", "Unreal Engine"] },
    { name: "Metahuman Animator", description: "Personagens digitais realistas com captura facial e expressões.", icon: "fas fa-user-astronaut", color: "#4ecdc4", tags: ["MetaHuman", "UE5"] },
    { name: "Virtual Production VFX", description: "Produção virtual com LED walls e cenários digitais de alta fidelidade.", icon: "fas fa-video", color: "#ffe66d", tags: ["LED Wall", "Virtual Sets"] },
    { name: "Tela Verde VFX", description: "Integração de chroma key com ambientes 3D renderizados em tempo real.", icon: "fas fa-film", color: "#a8e6cf", tags: ["Chroma Key", "Compositing"] },
    { name: "Animação Digital", description: "Do conceito à renderização final — animação 3D completa para qualquer mídia.", icon: "fas fa-magic", color: "#c77dff", tags: ["Cinema 4D", "Blender"] },
    { name: "3D Spatial Audio", description: "Design sonoro espacial imersivo para experiências em 360° e XR.", icon: "fas fa-headphones", color: "#ff9f43", tags: ["Spatial Audio", "Ambisonics"] }
];

export const fortniteProjects = [
    { name: "Experiência de Marca", description: "Ilhas Fortnite personalizadas que transformam produtos em experiências imersivas.", image: "/images/fortnite-logo.png", tags: ["UEFN", "Verse"], highlight: "Marketing Imersivo" },
    { name: "Mapa Competitivo", description: "Arenas de alto desempenho balanceadas para torneios e eventos eSports.", image: null, tags: ["UEFN", "Game Design"], highlight: "eSports Ready" },
    { name: "Skin Personalizada", description: "Personagens e skins customizados para representar sua marca no metaverso.", image: "/images/fortnite-skin1.png", tags: ["3D Modeling", "Rigging"], highlight: "Brand Identity" },
    { name: "Evento Interativo", description: "Eventos ao vivo dentro do Fortnite com mecânicas dinâmicas e storytelling.", image: null, tags: ["Live Events", "Narrative"], highlight: "Live Experience" }
];

export const robloxProjects = [
    { name: "Experiência de Marca", description: "Mundos Roblox que transformam sua marca em uma aventura interativa para todas as idades.", icon: "fas fa-globe", color: "#e74c3c", tags: ["Roblox Studio", "Lua"] },
    { name: "Obby Personalizado", description: "Obstacle courses únicas com identidade visual e mecânicas da sua marca.", icon: "fas fa-flag-checkered", color: "#f39c12", tags: ["Game Design", "Scripting"] },
    { name: "Avatar & Itens UGC", description: "Criação de avatares, roupas e acessórios UGC para o marketplace do Roblox.", icon: "fas fa-tshirt", color: "#2ecc71", tags: ["UGC", "3D Art"] },
    { name: "Evento Sazonal", description: "Ativações sazonais e temporadas de conteúdo para manter o engajamento contínuo.", icon: "fas fa-calendar-star", color: "#9b59b6", tags: ["Live Ops", "Events"] }
];
