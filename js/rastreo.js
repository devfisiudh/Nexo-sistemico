document.addEventListener('DOMContentLoaded', () => {
    const consoleOutput = document.getElementById('console-output');
    
    // Mensajes falsos de carga del sistema
    const messages = [
        "> Iniciando módulos de GPS...",
        "> Conectando con servidor UDH...",
        "> [OK] API Satelital detectada.",
        "> Calibrando sensores...",
        "> Esperando señal de buses...",
        "> Sistema en modo espera (Standby)."
    ];

    let delay = 0;

    // Limpiamos la consola inicial
    consoleOutput.innerHTML = "";

    messages.forEach((msg, index) => {
        // Añadimos un retraso progresivo para cada mensaje (efecto máquina de escribir)
        setTimeout(() => {
            consoleOutput.innerHTML += msg + "<br>";
            // Auto scroll hacia abajo
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        }, delay);
        
        delay += 800; // 0.8 segundos entre cada mensaje
    });
});