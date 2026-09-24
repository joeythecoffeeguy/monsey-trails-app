import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { PassengerTripActivityProps } from './passenger-trip-activity-types';

function PassengerTripActivity(
  props: PassengerTripActivityProps,
  environment: LiveActivityEnvironment,
) {
  'widget';

  const navy = environment.isLuminanceReduced ? '#FFFFFF' : '#062341';
  const muted = environment.isLuminanceReduced ? '#D1D5DB' : '#64748B';
  const lime = environment.isLuminanceReduced ? '#FFFFFF' : '#CAF020';
  const isStale = environment.isStale === true;
  const eta = isStale ? 'Check app' : props.etaLabel;
  const status = isStale ? 'Updates paused — check the app' : props.status;
  const updatedAtDate = new Date(props.updatedAt);
  const updatedAtLabel = Number.isFinite(updatedAtDate.getTime())
    ? updatedAtDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'time unavailable';
  const phaseLabel =
    props.phase === 'pickup'
      ? 'Pickup'
      : props.phase === 'onboard'
        ? 'On board'
        : props.phase === 'ended'
          ? 'Trip ended'
          : 'Status';

  const banner = (
    <VStack modifiers={[padding({ all: 14 })]} spacing={8}>
      <HStack spacing={8}>
        <Image systemName="bus.fill" color={lime} />
        <Text modifiers={[font({ weight: 'bold', size: 16 }), foregroundStyle(navy)]}>
          {props.lineName}
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>
          {props.coachNumber ? `Coach ${props.coachNumber}` : phaseLabel}
        </Text>
      </HStack>
      <Text modifiers={[font({ weight: 'semibold', size: 15 }), foregroundStyle(navy)]}>
        {props.stopName}
      </Text>
      <HStack spacing={8}>
        <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle(navy)]}>
          {eta}
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{status}</Text>
      </HStack>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>
        Updated {updatedAtLabel}
      </Text>
    </VStack>
  );

  return {
    banner,
    compactLeading: <Image systemName="bus.fill" color={lime} />,
    compactTrailing: (
      <Text modifiers={[font({ weight: 'semibold', size: 12 })]}>{eta}</Text>
    ),
    minimal: <Image systemName="bus.fill" color={lime} />,
    expandedLeading: (
      <VStack modifiers={[padding({ all: 8 })]} spacing={5}>
        <Image systemName="bus.fill" color={lime} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{phaseLabel}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 8 })]} spacing={4}>
        <Text modifiers={[font({ weight: 'bold', size: 17 }), foregroundStyle(navy)]}>
          {eta}
        </Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>ETA</Text>
      </VStack>
    ),
    expandedBottom: (
      <VStack modifiers={[padding({ all: 10 })]} spacing={5}>
        <Text modifiers={[font({ weight: 'semibold', size: 14 }), foregroundStyle(navy)]}>
          {props.lineName} · {props.stopName}
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{status}</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>
          {props.coachNumber ? `Coach ${props.coachNumber} · ` : ''}Updated {updatedAtLabel}
        </Text>
      </VStack>
    ),
  };
}

export default createLiveActivity('PassengerTripActivity', PassengerTripActivity);