# Roteiro de entrevista · Reconstruir uma viagem de carga (#8)

Português do Brasil. Versão em espanhol: `interview.es.md`.

Duração: de 40 a 50 minutos, com uma pessoa por vez. O caminhoneiro e o contato de confiança são entrevistados separadamente, para que cada relato seja próprio.

## Antes de começar (para quem entrevista)

- Confirme que o recrutamento está autorizado e que você tem o consentimento da pessoa, incluindo a permissão para gravar. Sem isso, não comece. Anote a referência do consentimento guardado fora do repositório em `consent_ref`; sem essa referência, a validação falha.
- Nunca entreviste alguém que está dirigindo. Se o caminhoneiro estiver na estrada, combinem outro momento com o caminhão parado.
- Este estudo olha para trás. Nunca peça a ninguém que dirija cansado, que segure o sono, que simule um roubo ou que provoque uma emergência.
- Use só os códigos do estudo, por exemplo `P03-D`. Não anote nomes, telefones, placas, endereços nem detalhes da carga que identifiquem alguém.
- Marque cada horário como **registrado** (vem de uma mensagem, uma ligação, um rastreador ou um documento) ou **lembrado**. Se a pessoa der um horário aproximado, anote uma faixa, por exemplo "entre 20:30 e 21:00". Um "mais ou menos" nunca vira horário exato.
- Separe o que a pessoa viveu, o que contaram para ela e o que ela temeu. "Achei que tinham assaltado o caminhão" é uma suspeita. A falta de resposta, sozinha, deixa o estado desconhecido; não cria suspeita de cansaço, sono ou roubo. Se a pessoa expressou uma preocupação, anote quem a teve, em qual fonte disse isso e por quê. Mantenha essa preocupação separada do estado do contato.
- Se o caminhoneiro e o contato contarem coisas diferentes, anote as duas versões. Não decida durante a entrevista qual está certa.
- Falar de um roubo ou de ter cochilado ao volante pode ser difícil. Lembre que dá para pular qualquer pergunta ou parar. Se a pessoa ficar angustiada, faça uma pausa.
- O estudo não presta socorro. Se houver uma emergência em andamento, pare a entrevista e peça que a pessoa ligue para o número de emergência do local onde está.

## Para começar

"Agradecemos o seu tempo. Queremos entender como você e [o seu contato / o caminhoneiro] se mantêm informados durante as viagens de carga, e o que aconteceu em duas viagens específicas. Não existem respostas certas. Você pode pular qualquer pergunta ou parar quando quiser. Se falar de outras pessoas, use só a relação com você, por exemplo "meu irmão" ou "um colega de estrada". O que você contar fica guardado com um código, sem o seu nome."

Em seguida, leia o que o termo de consentimento diz sobre quem pode ver as informações. Não prometa nada que o termo não diga.

## 1. Contexto (5 min)

Para o caminhoneiro:

1. Quantos caminhões você tem ou opera? Você trabalha por conta própria, para uma empresa ou de outro jeito?
2. Que viagens você faz: locais, entre cidades, internacionais? Com que frequência?
3. O que você usa hoje para alguém saber onde você está ou como está a viagem: mensagens, ligações, localização compartilhada, rádio, um rastreador ou uma gerenciadora de risco? Quem instalou e quanto custa?
4. Mais alguém acompanha as suas viagens, como a transportadora, o embarcador ou a seguradora? O que acontece quando eles perdem o sinal?

Para o contato:

1. Qual é a sua relação com o caminhoneiro?
2. Quando ele sai para uma viagem, o que vocês costumam combinar? Uma mensagem ao chegar, uma a cada parada, uma ligação, nada?
3. Por qual meio: WhatsApp, ligação, SMS, rádio ou outro?

## 2. Escolher duas viagens (5 min)

- Uma viagem de carga recente que preocupou alguém: um roubo ou uma tentativa de roubo, uma situação que pareceu insegura, cansaço ou sono, não achar onde descansar, ou simplesmente não conseguir confirmar que o caminhoneiro estava bem. Não precisa ter sido uma emergência.
- Uma viagem comum, de preferência uma em que a resposta demorou, mas estava tudo bem.

## 3. Reconstruir a viagem preocupante (15 a 20 min)

Percorra a viagem em ordem. Em cada momento, pergunte:

- Que horas eram, mais ou menos? Você se lembra ou consegue ver em algum registro?
- O que você sabia naquele momento?
- O que você fez? O que pensou em fazer e não fez? Por quê?
- Quem mais participou? (Só a relação, sem nomes.)

Momentos que precisam ficar cobertos:

1. A saída, se o caminhão estava carregado ou vazio, e o tipo de trajeto.
2. As paradas para descansar ou dormir: quando, onde (de forma geral) e se foi fácil achar um lugar seguro.
3. Se houve cansaço ou sono: quando percebeu, o que fez e se contou para alguém.
4. Se houve algo inseguro: alguém seguindo, uma parada suspeita, uma tentativa de roubo ou um roubo. O que aconteceu, quem foi avisado e se houve boletim de ocorrência.
5. O horário combinado para avisar ou para chegar.
6. O primeiro momento em que alguém não soube se o caminhoneiro estava bem.
7. Cada tentativa de contato (mensagens, ligações, rádio) e o resultado.
8. As decisões: esperar, insistir, avisar outros caminhoneiros, a transportadora ou a polícia.
9. Quando e como se soube como terminou.

Para fechar esta parte: "Olhando para trás, houve um momento em que algo poderia ter sido feito antes? Quem poderia ter feito e o que precisaria saber?"

## 4. Registros daquela viagem (5 min)

- "Você tem registros daquela viagem: mensagens, histórico de ligações, localização, dados do rastreador, um boletim de ocorrência ou um aviso à seguradora?"
- Se a pessoa concordar, vejam juntos. Anote qual é o registro, o horário que ele mostra e o fuso horário do celular ou do sistema.
- Um boletim de ocorrência, por si só, registra uma declaração. Se repete o relato do caminhoneiro, mantenha como relato atribuído. Para corroborar um incidente, identifique observações independentes que sustentem aquele fato específico e a fonte. O horário de registro do boletim não é o horário observado do incidente.
- Um histórico de localização pode registrar uma parada. Não a transforme em descanso: `rest_start`, `rest_end` e `rest_difficulty` precisam do relato atribuído de um participante.
- Não copie mensagens de outras pessoas. A pessoa pode esconder o que não quiser mostrar antes de mostrar.
- Não peça a conversa inteira. Se for preciso guardar uma cópia, use o armazenamento privado do estudo.

## 5. A viagem comum (8 min)

Repita a parte 3 de forma breve. Preste atenção às respostas que chegaram atrasadas sem que nada tivesse acontecido: quanto demoraram e como a outra pessoa soube que estava tudo bem.

## 6. Ferramentas e proposta (5 min, sempre no fim)

1. O que custa hoje manter a sua gente informada: dinheiro, tempo, configuração, sinal?
2. Leia sem enfeitar: "Estamos estudando um serviço no celular, controlado pelo próprio caminhoneiro, que avisa os contatos de confiança quando um trecho não é confirmado ou quando há um pedido de ajuda." Pergunte: "Em qual das viagens que você contou isso teria mudado alguma coisa? O que preocuparia você ao usar?"
3. Anote as respostas como opiniões. Uma opinião sobre uma ideia não demonstra uso, demanda nem disposição para pagar.

## 7. Encerramento (2 min)

- "Tem algo dessas viagens que eu não perguntei e que é importante?"
- Explique a revisão: "Vamos mostrar o seu próprio relato para você corrigir. Você não vai ver o relato da outra pessoa."
- Agradeça.

## Depois da entrevista

No mesmo dia, passe as anotações para as planilhas na pasta privada (`evidence/private/`). Use uma linha por momento, com a fonte, com o horário marcado como registrado ou lembrado, e com a origem do fato: um registro, a própria pessoa, outra pessoa, uma suspeita ou uma fonte independente que o confirma.
