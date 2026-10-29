import sharp from 'sharp';
import {
  GenerationError,
  validateBlueprint,
  type BlueprintInput,
  type GeneratedMedia,
  type LockedEvidenceInput,
  type LockedVisualInput,
  type MysteryAIProvider,
  type PrivateBlueprint,
  type PublicReviewInput,
  type ReviewResult,
} from './contracts.js';

const at = (time: string) => `2026-10-28T${time}:00+05:30`;
export function mockBlueprint(input: BlueprintInput): PrivateBlueprint {
  const theme = /sabotag|tamper|power|disable/i.test(input.premise)
    ? 'sabotage'
    : /disappear|missing person|vanish|researcher/i.test(input.premise) &&
        !/trophy/i.test(input.premise)
      ? 'disappearance'
      : 'theft';
  const title =
    theme === 'sabotage'
      ? 'The Silent Soundboard'
      : theme === 'disappearance'
        ? 'The Vanishing Exhibition'
        : 'The Missing Festival Trophy';
  const item =
    theme === 'sabotage'
      ? 'soundboard power module'
      : theme === 'disappearance'
        ? 'exhibition sculpture'
        : 'festival trophy';
  const incident =
    theme === 'sabotage'
      ? 'The festival sound system failed shortly before the ceremony. Its power module had been removed from the locked backstage room.'
      : `The ${item} disappeared from a locked backstage room shortly before the university festival awards.`;
  const suspects = [
    {
      id: 'S-01',
      name: 'Asha Rao',
      age: 26,
      role: 'Festival host',
      relationshipToIncident: 'Hosted the ceremony and had backstage access.',
      statedAlibi: 'I was on stage continuously from 21:05 to 21:25.',
      publicStatement: 'I argued about the prize earlier, but the audience saw me presenting.',
      motivePossibility: 'Disagreed with the organizing committee.',
    },
    {
      id: 'S-02',
      name: 'Noah Bennett',
      age: 24,
      role: 'Stage assistant',
      relationshipToIncident: 'Managed the spare backstage key.',
      statedAlibi: 'I returned the spare key at 20:50 and worked at the front entrance.',
      publicStatement: 'Check the signed key-return record.',
      motivePossibility: 'Was passed over for a promotion.',
    },
    {
      id: 'S-03',
      name: 'Mira Sen',
      age: 28,
      role: 'Logistics coordinator',
      relationshipToIncident: 'Moved equipment between backstage and storage.',
      statedAlibi: 'I left the building at 21:00 and did not return.',
      publicStatement: 'My yellow-striped equipment bag stayed with the equipment.',
      motivePossibility: 'Wanted to embarrass the committee after a funding dispute.',
    },
    {
      id: 'S-04',
      name: 'Leo Hart',
      age: 25,
      role: 'Performer',
      relationshipToIncident: 'Performed at the festival and challenged the judging.',
      statedAlibi: 'I was rehearsing with the ensemble from 21:05 to 21:25.',
      publicStatement: 'My angry message was about unfair judging.',
      motivePossibility: 'Was upset about the award results.',
    },
  ];
  const observations = [
    `At 20:55, Mira Sen borrowed the main backstage key from Noah Bennett to check equipment. Noah asked for it back after the ceremony.`,
    'Leo Hart sent an angry message about award judging at 20:45; the reply confirms he would stay with the ensemble for rehearsal.',
    `The backstage display is empty. The ${item} was present at the 21:05 inspection, and no damage to the door or lock is visible.`,
    `A yellow-striped equipment bag in the equipment area is large enough to hold the ${item}. Mira Sen normally carries this distinctive bag.`,
    'CAM 02 at 21:17 records an adult carrying a yellow-striped equipment bag from the backstage corridor toward equipment storage. The face is not identifiable.',
    `At 21:20 the organizer reported the ${item} missing. The last confirmed inspection was at 21:05. The backstage door was locked and undamaged.`,
    'The access log records badge M-SEN assigned to Mira Sen opening the backstage door at 21:14, after her claimed 21:00 departure. No other suspect badge entered from 21:05 to 21:20.',
    'A witness confirms Asha Rao was on stage from 21:05 to 21:25, Noah Bennett returned the spare key at 20:50 and stayed at the front entrance, and Leo Hart rehearsed with the ensemble from 21:05 to 21:25.',
  ];
  const types = [
    'CHAT',
    'CHAT',
    'PHOTO',
    'PHOTO',
    'CCTV',
    'DOCUMENT',
    'DOCUMENT',
    'DOCUMENT',
  ] as const;
  const titles = [
    'The borrowed key',
    'An angry rehearsal message',
    'The empty display',
    'The yellow-striped bag',
    'Back corridor camera',
    'Incident report',
    'Backstage access log',
    'Witness statement',
  ];
  const times = ['20:55', '20:45', '21:20', '21:18', '21:17', '21:20', '21:14', '21:25'];
  const facts = observations.map((statement, i) => ({
    id: `FACT-${String(i + 1).padStart(2, '0')}`,
    statement,
    occurredAt: at(times[i]!),
    involvedSuspectIds:
      i === 1
        ? ['S-04']
        : i === 7
          ? ['S-01', 'S-02', 'S-04']
          : i === 0 || i === 3 || i === 6
            ? ['S-03']
            : [],
  }));
  return validateBlueprint({
    title,
    incident,
    location: 'Northbridge University Auditorium — fictional',
    timezone: 'Asia/Kolkata',
    fictionalDate: '2026-10-28',
    objective: `Identify who removed the ${item} and explain the timeline.`,
    suspects,
    culpritSuspectId: 'S-03',
    canonicalFacts: facts,
    actualTimeline: [
      { occurredAt: at('20:50'), event: 'Noah returns the spare key.' },
      { occurredAt: at('20:55'), event: 'Mira borrows the main backstage key.' },
      {
        occurredAt: at('21:05'),
        event: `The ${item} is still in place. Asha is on stage and Leo is rehearsing.`,
      },
      {
        occurredAt: at('21:14'),
        event: `Mira enters backstage with her badge and removes the ${item}, hiding it inside the yellow-striped equipment bag.`,
      },
      { occurredAt: at('21:17'), event: 'Mira carries the bag toward equipment storage.' },
      { occurredAt: at('21:20'), event: `The ${item} is discovered missing.` },
    ],
    evidencePlans: observations.map((observation, i) => ({
      id: `EV-${String(i + 1).padStart(2, '0')}`,
      type: types[i],
      title: titles[i],
      source:
        i < 2
          ? 'Fictional organizer messenger'
          : i === 4
            ? 'CAM 02 — reconstructed footage'
            : 'Festival investigation dossier',
      occurredAt: at(times[i]!),
      factIds: [facts[i]!.id],
      authoredObservation: observation,
      renderBrief:
        i === 2
          ? `Dim empty backstage display pedestal, undamaged closed door, festival decorations. The ${item} is absent.`
          : i === 3
            ? 'Yellow-striped dark equipment bag on the floor beside anonymous stage equipment, fictional indoor university auditorium.'
            : i === 4
              ? 'High-angle static security camera, dim backstage corridor, adult in plain clothes carrying a dark yellow-striped equipment bag toward storage, face indistinct, no cuts or invented action.'
              : observation,
      ...(i === 0 ? { chatParticipants: ['Mira Sen', 'Noah Bennett'] } : {}),
      ...(i === 1 ? { chatParticipants: ['Leo Hart', 'Ensemble coordinator'] } : {}),
      ...(i === 4 ? { cameraLabel: 'CAM 02', cameraTimestamp: at('21:17') } : {}),
      ...(i >= 5
        ? { documentKind: i === 5 ? 'INCIDENT_REPORT' : i === 6 ? 'ACCESS_LOG' : 'WITNESS' }
        : {}),
    })),
    solution: {
      motive:
        'Mira wanted to embarrass the festival committee after a dispute over logistics funding.',
      method: `She used the borrowed main key and her own badge, removed the ${item}, and concealed it in her yellow-striped equipment bag.`,
      opportunity:
        'At 21:14 she accessed backstage while the other suspects were observed elsewhere, contradicting her claim that she had left at 21:00.',
      supportingEvidenceIds: ['EV-01', 'EV-04', 'EV-05', 'EV-07'],
      redHerringExplanations: {
        'EV-02':
          "Leo's anger concerned judging; the witness places him at rehearsal throughout the incident window.",
      },
      suspectEliminationReasons: {
        'S-01': 'Asha was seen presenting on stage throughout the incident window.',
        'S-02':
          'Noah returned the spare key before the incident and was observed at the front entrance.',
        'S-04': 'Leo was at ensemble rehearsal; his angry message did not establish opportunity.',
      },
      verdictExplanation: `Mira Sen removed the ${item}. EV-01 gives her the key, EV-07 places her inside at 21:14 after her claimed departure, and EV-05 connects the distinctive bag to the removal route. EV-04 corroborates the bag. The independent witness rules out the other suspects.`,
      hintTexts: [
        'Compare each suspect’s claimed whereabouts with the recorded times.',
        'A borrowed key and a late badge entry connect two different evidence items.',
        'The 21:14 entry contradicts a 21:00 departure. Connect that discrepancy to the yellow-striped bag in the corridor.',
      ],
    },
  });
}

const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

export class MockAIProvider implements MysteryAIProvider {
  readonly mode = 'mock' as const;
  async generateBlueprint(input: BlueprintInput) {
    return mockBlueprint(input);
  }
  async reviewSolvability(input: PublicReviewInput): Promise<ReviewResult> {
    const log = input.evidence.find((e) => e.id === 'EV-07');
    const suspect = input.suspects.find(
      (s) => log?.observation.includes(s.name) && /21:00/.test(s.statedAlibi),
    );
    return {
      verdict: suspect ? 'ACCEPT' : 'REJECT',
      suspectId: suspect?.id ?? null,
      reasons:
        'The badge log contradicts the departure alibi and corroborates the key and bag clues.',
      ambiguous: !suspect,
    };
  }
  async generateChat({ plan }: LockedEvidenceInput) {
    const participants = plan.chatParticipants!;
    const texts =
      plan.id === 'EV-01'
        ? [
            'Can I borrow the main backstage key to check the equipment?',
            'Yes, take it. I already returned the spare key.',
            'Thanks. I will keep the main key until after the ceremony.',
            'Please bring it back then.',
          ]
        : [
            'That judging decision was unfair. I am furious about it.',
            'We can discuss it after the ceremony. Rehearsal starts at 21:05.',
            'I will stay with the ensemble until 21:25.',
            'Understood. See you at rehearsal.',
          ];
    return texts.map((text, i) => ({
      id: `MSG-${i + 1}`,
      sender: participants[i % 2]!,
      timestamp: new Date(Date.parse(plan.occurredAt) + i * 1000).toISOString(),
      text,
    }));
  }
  async generateDocument({ plan }: LockedEvidenceInput) {
    return `FICTIONAL INVESTIGATION RECORD\n${plan.title}\nRecorded: ${plan.occurredAt}\n\n${plan.authoredObservation}\n\nSource: ${plan.source}\nThis record is a synthetic game artifact.`;
  }
  async generatePhoto({ plan, frameIndex = 0 }: LockedVisualInput): Promise<GeneratedMedia> {
    const corridor = plan.type === 'CCTV';
    const scene = corridor
      ? `<path d="M0 0H1280L780 270H500Z" fill="#34404b"/><path d="M0 720H1280L780 270H500Z" fill="#18202a"/><path d="M0 0L500 270V450L0 720Z" fill="#222d39"/><path d="M1280 0L780 270V450L1280 720Z" fill="#293441"/><rect x="${650 + frameIndex * 80}" y="290" width="54" height="165" rx="18" fill="#15191f"/><circle cx="${677 + frameIndex * 80}" cy="268" r="25" fill="#40474c"/><rect x="${690 + frameIndex * 80}" y="370" width="90" height="66" rx="8" fill="#0e1118"/><path d="M${700 + frameIndex * 80} 370v66" stroke="#d9a74d" stroke-width="12"/>`
      : plan.id === 'EV-03'
        ? '<rect x="60" y="90" width="1160" height="530" fill="#263241"/><rect x="840" y="140" width="240" height="430" fill="#131b26"/><circle cx="1050" cy="355" r="8" fill="#cba45e"/><path d="M100 620L480 480H720L1100 620Z" fill="#17202d"/><rect x="490" y="390" width="220" height="220" fill="#43515e"/><ellipse cx="600" cy="390" rx="110" ry="24" fill="#65727c"/><ellipse cx="600" cy="390" rx="55" ry="10" fill="#26313b"/>'
        : '<rect x="40" y="90" width="1200" height="560" fill="#26313a"/><rect x="90" y="170" width="230" height="420" fill="#17222b"/><rect x="950" y="130" width="180" height="470" fill="#17222b"/><rect x="440" y="360" width="410" height="220" rx="30" fill="#101720"/><path d="M520 360v220" stroke="#d9a74d" stroke-width="45"/><path d="M570 360v220" stroke="#c79b43" stroke-width="12"/><path d="M570 360v-50h130v50" fill="none" stroke="#131a22" stroke-width="20"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#101721"/>${scene}<rect y="0" width="1280" height="74" fill="#080c12"/><text x="32" y="46" fill="#d9a74d" font-size="24" font-family="sans-serif">DEMO MODE · FICTIONAL TEST EVIDENCE</text><rect y="644" width="1280" height="76" fill="#080c12"/><text x="32" y="689" fill="#eef2f7" font-family="sans-serif" font-size="22">${escapeXml(plan.title)}</text></svg>`;
    return {
      data: await sharp(Buffer.from(svg)).png().toBuffer(),
      mimeType: 'image/png',
      method: 'MOCK',
    };
  }
  async generateCctvVideo(): Promise<GeneratedMedia> {
    throw new GenerationError(
      'MOCK_FRAME_VIDEO',
      'Demo CCTV is compiled from deterministic test frames.',
      false,
    );
  }
}
