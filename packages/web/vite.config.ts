import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		port: 3000,
		open: false,
		host: "127.0.0.1",
		strictPort: true,
	},
});
