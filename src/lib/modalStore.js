import { writable } from 'svelte/store';

export const contactModalState = writable({
    isOpen: false,
    title: ''
});

export const portfolioModalState = writable({
    isOpen: false,
    activeTab: 'jogos'
});

export const iframeModalState = writable({
    isOpen: false,
    url: ''
});

export const productsModalState = writable({
    isOpen: false,
    selectedCategory: 'all',
    selectedProductId: null,
    directCheckout: false,
    checkoutMode: 'compra'
});

export const globalLoading = writable(true);

// Persist splash screen state in sessionStorage
const isBrowser = typeof window !== 'undefined';
const storedHasSeen = isBrowser ? sessionStorage.getItem('hasSeenSplashScreen') === 'true' : false;

export const hasSeenSplashScreen = writable(storedHasSeen);

if (isBrowser) {
    hasSeenSplashScreen.subscribe(value => {
        sessionStorage.setItem('hasSeenSplashScreen', value);
    });
}
