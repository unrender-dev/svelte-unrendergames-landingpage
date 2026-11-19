export function portal(node) {
    let target = document.body;
    target.appendChild(node);

    return {
        destroy() {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        }
    };
}
