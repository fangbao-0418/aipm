import { useCallback, useEffect, useLayoutEffect } from "react";

export const useStopWhellHook = () => {
    const onWhell = useCallback((e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }, [])
    const onKeydown = useCallback((e: KeyboardEvent) => {
        if (
            (e.ctrlKey || e.metaKey) &&
            (e.key === '+' || e.key === '-' || e.key === '=')
        ) {
            e.preventDefault();
        }
    }, [])
    useLayoutEffect(() => {
        window.addEventListener('wheel', onWhell, { passive: false });
        window.addEventListener('keydown', onKeydown);
        return () => {
            window.removeEventListener('wheel', onWhell);
            window.removeEventListener('keydown', onKeydown);
        }
    })
}