import { motion } from "motion/react";
import type { ReactNode } from "react";

export function Shimmer({ children }: { children: ReactNode }) {
  return (
    <motion.span
      style={{
        backgroundImage: "linear-gradient(90deg, oklch(0.708 0 0) 0%, oklch(0.985 0 0) 50%, oklch(0.708 0 0) 100%)",
        backgroundSize: "200% 100%",
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        color: "transparent",
        display: "inline-block"
      }}
      animate={{ backgroundPosition: ["100% center", "0% center"] }}
      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
    >
      {children}
    </motion.span>
  );
}
