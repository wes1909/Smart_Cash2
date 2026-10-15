# Apoio à decisão no módulo de dívidas

## Objetivo e escopo

O mecanismo v1 classifica dívidas ativas em Alta, Média ou Baixa e apresenta os motivos. A decisão de pagamento permanece com o usuário. Não executa pagamentos, não usa aprendizado de máquina, serviços externos ou APIs de IA. Banco, RPC, histórico e amortização permanecem inalterados.

## Dados e projeção

Usa saldo atual, taxa mensal, parcela mínima quando informada e ID para desempate. Reutiliza `calcValorFuturo(saldoAtual, jurosMensal, 12)` sem modificar a fórmula: `VF = saldo × (1 + taxa/100)^12`. Calcula crescimento absoluto `C = VF − saldo` e percentual `P = 100 × C/saldo`. A projeção pressupõe ausência de pagamentos e taxa constante.

Somente dívidas ativas com saldo e taxa numéricos, finitos e não negativos, além de projeção finita, entram na comparação. Saldo zero significa quitada. Dados inválidos produzem “Não classificada”, sem recomendação, e não contaminam as referências das demais dívidas.

Sejam `N` a quantidade de dívidas ativas analisáveis e `S` a soma de seus crescimentos. A participação é `C/S`, ou zero se S for zero. Impacto igual ou superior à média significa `N > 1`, `C > 0` e participação `>= 1/N`. A implementação normaliza os valores pelo maior crescimento antes de somar, evitando overflow. A soma ocorre em ordem numérica fixa para independência da ordem de entrada.

## Cinco regras e precedência

1. **R1 — Quitada:** saldo zero; sem prioridade e fora das recomendações.
2. **R2 — Alta:** taxa mensal `>= 5%` combinada com impacto igual ou superior à média; ou participação `>= 60%` do crescimento total, com pelo menos duas dívidas analisáveis. Havendo apenas uma dívida analisável, taxa `>= 5%` basta: não se fabrica uma comparação relativa nesse caso.
3. **R3 — Média:** se não for Alta, crescimento percentual em 12 meses `>= 25%` ou impacto igual ou superior à média.
4. **R4 — Baixa:** demais dívidas ativas analisáveis. Uma dívida única com crescimento inferior a 25%, ou dívidas sem crescimento, podem ser Baixa.
5. **R5 — Contexto da parcela:** parcela positiva e finita `<= saldo × taxa/100` gera observação de que não supera os juros estimados de um mês. Não altera a classe. Parcela ausente, zero ou inválida não gera esse aviso.

R1 precede a validação da taxa. Após validar uma dívida ativa, aplica-se R2, senão R3, senão R4; R5 apenas complementa a explicação. Cada resultado contém prioridade, nível ordinal, IDs das regras acionadas, justificativa e observação. Os motivos citam exclusivamente condições verdadeiras. Taxa e crescimento percentual são relacionados matematicamente e não recebem pontos independentes.

Os parâmetros 5%, 25% e 60% são escolhas explícitas de modelagem acadêmica, não limites universais. 5% identifica custo proporcional elevado; 25% representa crescimento anual relevante; 60% identifica concentração de pelo menos 1,5 vez o crescimento de todas as outras dívidas juntas. Esses valores precisam de validação com cenários e usuários. Não existem limites fixos em reais.

## Ordenação e atualização

Ativas primeiro; depois classe decrescente (Alta, Média, Baixa, não classificada), crescimento absoluto decrescente, taxa decrescente e ID crescente. Quitadas ficam ao final. O ID estabiliza a apresentação sem implicar maior urgência financeira. O maior item ordenado com classe recebe destaque como apoio à decisão, sem prescrever sequência de pagamentos.

A função é pura e não altera os registros. A tabela e a recomendação consomem a mesma análise. A amortização já chama `renderDividas()` após confirmação da RPC; essa renderização lê os novos saldos e recalcula todas as classes. Não se persiste classificação potencialmente desatualizada.

## Exemplos

Valores projetados sem pagamentos:

| Dívida | Saldo | Taxa mensal | Crescimento em 12 meses | Classe |
|---|---:|---:|---:|---|
| A | R$ 1.000,00 | 8% | R$ 1.518,17 (151,82%) | Alta |
| B | R$ 2.000,00 | 2% | R$ 536,48 (26,82%) | Média |
| C | R$ 500,00 | 1% | R$ 63,41 (12,68%) | Baixa |

A tem taxa elevada e crescimento acima da média, além de concentrar mais de 60% do crescimento total. B supera 25% em 12 meses, mas não satisfaz R2. C fica abaixo de 25% e abaixo da média em reais. Se A tivesse parcela mínima de R$ 80, receberia também o aviso R5, pois os juros estimados do primeiro mês são R$ 80.

Uma dívida de R$ 10.000 a 1% e outra de R$ 100 a 1% tornam a primeira Alta por concentração do impacto em reais, mesmo sem taxa elevada. Duas dívidas idênticas a 1% recebem Média por impacto igual à média; a posição na lista não força uma delas a ser Alta.

## Enquadramento e limitações

Trata-se de apoio à tomada de decisão baseado em regras: conhecimento explícito em condições SE–ENTÃO, precedência definida e explicação vinculada às condições acionadas. Não há treinamento, inferência probabilística ou decisão automática de pagamento.

O resultado é determinístico para os mesmos registros válidos e parâmetros. Com as outras dívidas fixas e cálculos finitos, elevar a taxa ou o saldo de uma dívida não reduz sua própria classe: seu percentual e/ou participação não diminuem. Isso não impede mudanças na classe das outras dívidas. A composição da carteira pode mudar a classificação mesmo sem alteração individual; essa é uma consequência intencional da comparação relativa, inclusive após amortização.

Não considera renda disponível, vencimentos, atrasos, garantias, encargos adicionais, renegociação ou prioridades pessoais. Histórico ausente não prova inadimplência; o histórico não é usado para penalizar a classificação. A comparação da parcela não modela as condições de apropriação de pagamentos pelo credor. Baixa não significa que a dívida pode ser ignorada. Taxas constantes e ausência de pagamentos limitam a projeção. Há mudanças de classe nas fronteiras e precisão de ponto flutuante; comparações usam os valores calculados sem arredondamento, e apenas a exibição é arredondada. Valores extremos com projeção não finita ficam sem classificação. A estratégia não garante a melhor alocação de recursos nem o menor custo total.

## Verificação

`tests/debt-priority.test.cjs` cobre classes, fronteiras inclusivas, precedência, quitadas, justificativas, parcelas, inválidas, determinismo, imutabilidade, monotonicidade com pares fixos, renderização e recálculo após amortização confirmada. Testes de sessão preservam isolamento e testes de persistência preservam a assinatura da RPC e o histórico.
