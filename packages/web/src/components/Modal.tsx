import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
export function Modal({
	title,
	subtitle,
	onClose,
	children,
}: {
	title: string;
	subtitle?: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);
	return (
		<dialog
			ref={ref}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			aria-label={title}
			className="dialog-shell rounded-3xl p-5 sm:p-6 bg-white text-slate-800 shadow-2xl"
		>
			<div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
				<div>
					<h2 className="text-base font-bold">{title}</h2>
					{subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
				</div>
				<button
					type="button"
					aria-label="关闭弹窗"
					onClick={onClose}
					className="rounded-full p-1 hover:bg-slate-100"
				>
					<X className="w-5 h-5" />
				</button>
			</div>
			<div className="py-4">{children}</div>
		</dialog>
	);
}
