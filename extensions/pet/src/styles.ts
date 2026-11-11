export const STYLES = `
.milu-ext-pet-overlay {
	position: fixed;
	right: 18px;
	bottom: 92px;
	z-index: 5;
	pointer-events: none;
}

.milu-ext-pet-root {
	display: grid;
	place-items: center;
	width: 100%;
	height: 100%;
	background: transparent;
}

.milu-ext-pet-failed {
	max-width: 100%;
	padding: 4px 6px;
	font-family: ui-monospace, monospace;
	font-size: 9px;
	line-height: 1.3;
	word-break: break-all;
	color: #ff5f56;
	background: rgba(0, 0, 0, 0.55);
}

.milu-ext-pet-sprite {
	background-repeat: no-repeat;
	animation: milu-ext-pet-frames var(--pet-duration) steps(var(--pet-steps), end) infinite;
}

@keyframes milu-ext-pet-frames {
	from {
		background-position-x: 0;
	}

	to {
		background-position-x: var(--pet-frames);
	}
}

@media (prefers-reduced-motion: reduce) {
	.milu-ext-pet-sprite {
		animation: none;
	}
}
`;
