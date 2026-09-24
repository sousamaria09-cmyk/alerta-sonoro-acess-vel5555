```javascript
/* =========================================================
   ALARME SONORO ACESSÍVEL
   JavaScript + Web Audio API

   O programa:
   1. Solicita acesso ao microfone.
   2. Analisa o áudio em tempo real.
   3. NÃO grava e NÃO armazena o áudio.
   4. Calcula uma intensidade aproximada de 0 a 100.
   5. Adapta automaticamente a sensibilidade ao ambiente.
   6. Atualiza os alertas visuais.
   ========================================================= */


/* ---------------------------------------------------------
   ELEMENTOS DA PÁGINA
   --------------------------------------------------------- */

const microphoneButton =
    document.getElementById("microphoneButton");

const microphoneStatus =
    document.getElementById("microphoneStatus");

const alertCard =
    document.getElementById("alertCard");

const statusEmoji =
    document.getElementById("statusEmoji");

const statusTitle =
    document.getElementById("statusTitle");

const statusMessage =
    document.getElementById("statusMessage");

const statusDescription =
    document.getElementById("statusDescription");

const meterFill =
    document.getElementById("meterFill");

const intensityValue =
    document.getElementById("intensityValue");

const meter =
    document.querySelector(".meter");


/* ---------------------------------------------------------
   VARIÁVEIS DA WEB AUDIO API
   --------------------------------------------------------- */

let audioContext = null;

let analyser = null;

let microphoneStream = null;

let microphoneSource = null;

let animationFrame = null;


/* ---------------------------------------------------------
   VARIÁVEIS PARA A SENSIBILIDADE AUTOMÁTICA
   --------------------------------------------------------- */

/*
   A "linha de base" representa aproximadamente o nível
   normal de ruído do ambiente.

   Ela começa baixa e é calculada durante a calibração.
*/

let noiseFloor = 0;


/*
   Durante os primeiros segundos, coletamos vários valores
   para descobrir o ruído normal do ambiente.
*/

let calibrationValues = [];


/*
   Indica se o sistema ainda está calibrando.
*/

let isCalibrating = false;


/*
   Quantidade aproximada de frames usados na calibração.

   O valor real depende da taxa de atualização do navegador.
*/

const CALIBRATION_FRAMES = 180;


/*
   Contador de frames da calibração.
*/

let calibrationFrames = 0;


/*
   Suavização da intensidade.

   Isso evita que a barra fique pulando de forma exagerada.
*/

let smoothedIntensity = 0;


/* ---------------------------------------------------------
   CONFIGURAÇÃO DO ANALISADOR
   --------------------------------------------------------- */

/*
   fftSize define a quantidade de dados utilizados pelo
   AnalyserNode.

   Para detectar intensidade geral do som, não precisamos
   analisar palavras ou frequências específicas.
*/

const FFT_SIZE = 2048;


/* ---------------------------------------------------------
   BOTÃO PRINCIPAL
   --------------------------------------------------------- */

microphoneButton.addEventListener(
    "click",
    toggleMicrophone
);


/* ---------------------------------------------------------
   ATIVA OU DESATIVA O MICROFONE
   --------------------------------------------------------- */

async function toggleMicrophone() {

    /*
       Se já existe uma captura ativa, o botão funciona
       como botão para desligar o microfone.
    */

    if (microphoneStream) {
        stopMicrophone();
        return;
    }


    await startMicrophone();
}


/* ---------------------------------------------------------
   INICIAR MICROFONE
   --------------------------------------------------------- */

async function startMicrophone() {

    /*
       getUserMedia() solicita autorização ao navegador.

       IMPORTANTE:
       O áudio não é gravado.
       O navegador apenas fornece os dados necessários
       para a Web Audio API analisar a intensidade.
    */

    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {

        updateInterfaceError(
            "Seu navegador não oferece suporte ao acesso ao microfone."
        );

        return;
    }


    try {

        /*
           Pedimos somente acesso ao áudio.

           echoCancellation, noiseSuppression e autoGainControl
           são desativados para que a medição represente melhor
           o sinal captado pelo microfone.

           Não existe video: false.
        */

        microphoneStream =
            await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                video: false
            });


        /*
           Criamos o contexto de áudio.

           A Web Audio API será usada apenas para analisar
           o sinal recebido.
        */

        audioContext =
            new (window.AudioContext ||
                window.webkitAudioContext)();


        /*
           Criamos um AnalyserNode.

           Ele permite obter dados do áudio em tempo real.
        */

        analyser =
            audioContext.createAnalyser();


        analyser.fftSize = FFT_SIZE;


        /*
           smoothingTimeConstant suaviza pequenas variações.
        */

        analyser.smoothingTimeConstant = 0.8;


        /*
           Transformamos o MediaStream do microfone em uma
           fonte que pode ser analisada pela Web Audio API.
        */

        microphoneSource =
            audioContext.createMediaStreamSource(
                microphoneStream
            );


        /*
           Conectamos o microfone ao analisador.

           IMPORTANTE:

           Não conectamos o analyser ao destino
           (audioContext.destination).

           Portanto, o áudio do microfone não será reproduzido
           nos alto-falantes, evitando microfonia.
        */

        microphoneSource.connect(analyser);


        /*
           Preparamos a calibração automática.
        */

        calibrationValues = [];

        calibrationFrames = 0;

        noiseFloor = 0;

        smoothedIntensity = 0;

        isCalibrating = true;


        /*
           Atualizamos a interface.
        */

        microphoneButton.textContent =
            "⏹️ Desativar Microfone";

        microphoneButton.classList.add("active");

        microphoneStatus.textContent =
            "🎧 Microfone ativo. Calibrando o ruído ambiente...";


        setIdleState(
            "🎧",
            "Calibrando...",
            "Aguarde alguns segundos enquanto o sistema identifica o nível normal de ruído."
        );


        /*
           Começamos a análise contínua.
        */

        analyseSound();


    } catch (error) {

        /*
           Se o usuário negar a permissão ou ocorrer outro
           problema, mostramos uma mensagem amigável.
        */

        console.error(
            "Erro ao acessar o microfone:",
            error
        );


        let message =
            "Não foi possível acessar o microfone.";


        if (error.name === "NotAllowedError") {

            message =
                "Acesso ao microfone foi negado. Permita o acesso nas configurações do navegador.";

        } else if (error.name === "NotFoundError") {

            message =
                "Nenhum microfone foi encontrado neste dispositivo.";

        } else if (error.name === "NotReadableError") {

            message =
                "O microfone está sendo utilizado ou não pode ser acessado.";

        } else if (error.name === "SecurityError") {

            message =
                "O navegador bloqueou o acesso ao microfone por motivos de segurança.";
        }


        updateInterfaceError(message);
    }
}


/* ---------------------------------------------------------
   ANÁLISE DO SOM
   --------------------------------------------------------- */

function analyseSound() {

    /*
       Se não existe analisador, não há nada para analisar.
    */

    if (!analyser) {
        return;
    }


    /*
       Uint8Array recebe os dados de tempo do áudio.

       Cada valor fica entre 0 e 255.
       O centro aproximado do sinal é 128.
    */

    const dataArray =
        new Uint8Array(
            analyser.fftSize
        );


    /*
       Solicita os dados atuais do sinal.
    */

    analyser.getByteTimeDomainData(
        dataArray
    );


    /*
       Calculamos o RMS (Root Mean Square).

       O RMS é uma forma de medir a energia/intensidade
       do sinal de áudio.
    */

    let sumSquares = 0;


    for (let i = 0; i < dataArray.length; i++) {

        /*
           Convertemos o valor de 0-255 para aproximadamente
           -1 até +1.

           128 representa aproximadamente o centro do sinal.
        */

        const normalized =
            (dataArray[i] - 128) / 128;


        sumSquares +=
            normalized * normalized;
    }


    const rms =
        Math.sqrt(
            sumSquares / dataArray.length
        );


    /*
       Convertendo RMS para uma escala aproximada de 0 a 100.

       O objetivo aqui NÃO é mostrar decibéis reais.

       É uma escala visual relativa para o projeto escolar.
    */

    let rawLevel =
        Math.min(
            100,
            rms * 400
        );


    /*
       Durante a calibração, armazenamos os valores do ambiente.
    */

    if (isCalibrating) {

        calibrationValues.push(rawLevel);

        calibrationFrames++;


        /*
           Quando temos amostras suficientes, calculamos
           a média do ruído ambiente.
        */

        if (calibrationFrames >= CALIBRATION_FRAMES) {

            const average =
                calibrationValues.reduce(
                    (total, value) =>
                        total + value,
                    0
                ) /
                calibrationValues.length;


            noiseFloor = average;


            isCalibrating = false;


            microphoneStatus.textContent =
                "🎧 Microfone ativo. Monitorando o ambiente.";

        }


        /*
           Durante a calibração, mostramos o valor captado,
           mas mantemos o estado visual neutro.
        */

        updateMeter(rawLevel);

        requestNextFrame();

        return;
    }


    /* -----------------------------------------------------
       SENSIBILIDADE AUTOMÁTICA
       ----------------------------------------------------- */

    /*
       Se o ambiente estiver relativamente tranquilo,
       atualizamos lentamente a linha de base.

       O fator pequeno impede que a sensibilidade mude
       bruscamente.
    */

    const quietThreshold =
        noiseFloor + 5;


    if (rawLevel < quietThreshold) {

        noiseFloor =
            noiseFloor * 0.995 +
            rawLevel * 0.005;

    }


    /*
       Evitamos que o nível de referência fique abaixo
       de um pequeno valor mínimo.
    */

    noiseFloor =
        Math.max(
            noiseFloor,
            0.5
        );


    /* -----------------------------------------------------
       CALCULAR INTENSIDADE RELATIVA
       ----------------------------------------------------- */

    /*
       O som atual é comparado ao ruído ambiente.

       Quanto mais distante da linha de base,
       maior será a intensidade visual.
    */

    const difference =
        Math.max(
            0,
            rawLevel - noiseFloor
        );


    /*
       A sensibilidade cresce de acordo com o ambiente.

       Em ambientes silenciosos, pequenos sons podem
       aparecer com mais destaque.

       Em ambientes naturalmente mais barulhentos,
       o sistema se adapta.
    */

    const sensitivity =
        Math.max(
            12,
            noiseFloor * 0.9
        );


    let relativeIntensity =
        (difference / sensitivity) * 100;


    /*
       Também consideramos o próprio nível absoluto.

       Isso ajuda a tornar sons realmente fortes
       mais perceptíveis.
    */

    const absoluteComponent =
        rawLevel * 0.55;


    let intensity =
        Math.max(
            relativeIntensity,
            absoluteComponent
        );


    /*
       Limitamos entre 0 e 100.
    */

    intensity =
        Math.max(
            0,
            Math.min(
                100,
                intensity
            )
        );


    /*
       Suavização visual.

       70% do valor anterior +
       30% do valor atual.
    */

    smoothedIntensity =
        smoothedIntensity * 0.70 +
        intensity * 0.30;


    /*
       Atualizamos a barra e o número.
    */

    updateMeter(
        smoothedIntensity
    );


    /*
       Atualizamos o estado visual.
    */

    updateAlertState(
        smoothedIntensity
    );


    /*
       Pedimos ao navegador para executar a análise
       novamente no próximo frame.
    */

    requestNextFrame();
}


/* ---------------------------------------------------------
   CONTINUAR ANÁLISE
   --------------------------------------------------------- */

function requestNextFrame() {

    animationFrame =
        requestAnimationFrame(
            analyseSound
        );
}


/* ---------------------------------------------------------
   ATUALIZAR MEDIDOR
   --------------------------------------------------------- */

function updateMeter(value) {

    /*
       Garantimos que o valor fique entre 0 e 100.
    */

    const safeValue =
        Math.max(
            0,
            Math.min(
                100,
                value
            )
        );


    /*
       Atualiza a largura da barra.
    */

    meterFill.style.width =
        `${safeValue}%`;


    /*
       Mostra um número inteiro.
    */

    const rounded =
        Math.round(
            safeValue
        );


    intensityValue.textContent =
        rounded;


    /*
       Atualiza atributos de acessibilidade.
    */

    meter.setAttribute(
        "aria-valuenow",
        rounded
    );


    /*
       A cor da barra acompanha o estado.
    */

    if (safeValue < 35) {

        meterFill.style.backgroundColor =
            "#16a34a";

    } else if (safeValue < 70) {

        meterFill.style.backgroundColor =
            "#eab308";

    } else {

        meterFill.style.backgroundColor =
            "#dc2626";
    }
}


/* ---------------------------------------------------------
   ATUALIZAR ALERTA VISUAL
   --------------------------------------------------------- */

function updateAlertState(intensity) {

    /*
       Estado verde:
       intensidade abaixo de 35.
    */

    if (intensity < 35) {

        setAlertState(
            "low",
            "😊",
            "BAIXO RUÍDO",
            "Ambiente tranquilo",
            "O nível de ruído está baixo."
        );


    /*
       Estado amarelo:
       intensidade entre 35 e 70.
    */

    } else if (intensity < 70) {

        setAlertState(
            "moderate",
            "😟",
            "RUÍDO MODERADO",
            "Atenção!",
            "Existe um nível moderado de ruído no ambiente."
        );


    /*
       Estado vermelho:
       intensidade igual ou superior a 70.
    */

    } else {

        setAlertState(
            "high",
            "😠",
            "MUITO BARULHO",
            "Muito barulho!",
            "O nível de som está bastante elevado."
        );
    }
}


/* ---------------------------------------------------------
   ALTERAR ESTADO DO CARTÃO
   --------------------------------------------------------- */

function setAlertState(
    state,
    emoji,
    title,
    message,
    description
) {

    /*
       Remove os estados anteriores.
    */

    alertCard.classList.remove(
        "state-idle",
        "state-low",
        "state-moderate",
        "state-high"
    );


    /*
       Adiciona o novo estado.
    */

    alertCard.classList.add(
        `state-${state}`
    );


    /*
       Atualiza as informações visuais.
    */

    statusEmoji.textContent =
        emoji;

    statusTitle.textContent =
        title;

    statusMessage.textContent =
        message;

    statusDescription.textContent =
        description;
}


/* ---------------------------------------------------------
   ESTADO INICIAL / CALIBRAÇÃO
   --------------------------------------------------------- */

function setIdleState(
    emoji,
    title,
    description
) {

    alertCard.classList.remove(
        "state-low",
        "state-moderate",
        "state-high"
    );


    alertCard.classList.add(
        "state-idle"
    );


    statusEmoji.textContent =
        emoji;

    statusTitle.textContent =
        title;

    statusMessage.textContent =
        "";

    statusDescription.textContent =
        description;
}


/* ---------------------------------------------------------
   ERRO
   --------------------------------------------------------- */

function updateInterfaceError(message) {

    /*
       Mostramos o erro na área de status.
    */

    microphoneStatus.textContent =
        `⚠️ ${message}`;


    /*
       Mantemos a interface no estado inicial.
    */

    setIdleState(
        "⚠️",
        "Microfone não disponível",
        message
    );


    /*
       Garantimos que o botão volte ao estado inicial.
    */

    microphoneButton.textContent =
        "🎤 Ativar Microfone";

    microphoneButton.classList.remove(
        "active"
    );
}


/* ---------------------------------------------------------
   DESATIVAR MICROFONE
   --------------------------------------------------------- */

function stopMicrophone() {

    /*
       Cancelamos o loop de análise.
    */

    if (animationFrame) {

        cancelAnimationFrame(
            animationFrame
        );

        animationFrame = null;
    }


    /*
       Paramos todas as faixas do microfone.

       Isso encerra o acesso ao dispositivo.
    */

    if (microphoneStream) {

        microphoneStream
            .getTracks()
            .forEach(
                track => track.stop()
            );

        microphoneStream = null;
    }


    /*
       Desconectamos a fonte do analisador.
    */

    if (microphoneSource) {

        microphoneSource.disconnect();

        microphoneSource = null;
    }


    /*
       Fechamos o contexto de áudio.

       Isso libera os recursos utilizados pelo navegador.
    */

    if (audioContext) {

        audioContext.close();

        audioContext = null;
    }


    analyser = null;


    /*
       Reiniciamos as variáveis da análise.
    */

    noiseFloor = 0;

    calibrationValues = [];

    calibrationFrames = 0;

    isCalibrating = false;

    smoothedIntensity = 0;


    /*
       Voltamos o medidor para zero.
    */

    updateMeter(0);


    /*
       Atualizamos os textos.
    */

    microphoneButton.textContent =
        "🎤 Ativar Microfone";

    microphoneButton.classList.remove(
        "active"
    );


    microphoneStatus.textContent =
        "Microfone desativado.";


    setIdleState(
        "🎤",
        "Microfone desligado",
        "Clique no botão abaixo para começar."
    );
}


/* ---------------------------------------------------------
   SEGURANÇA EXTRA:
   Se o usuário fechar/recarregar a página,
   tentamos liberar o microfone.
   --------------------------------------------------------- */

window.addEventListener(
    "beforeunload",
    () => {

        if (microphoneStream) {

            microphoneStream
                .getTracks()
                .forEach(
                    track => track.stop()
                );
        }
    }
);
```
