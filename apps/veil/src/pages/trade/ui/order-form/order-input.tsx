import {
  memo,
  useId,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  KeyboardEvent,
  ChangeEvent,
  WheelEvent,
} from 'react';
import { useComponentSize } from 'react-use-size';
import { round } from '@penumbrafi/types/round';
import { Icon } from '@penumbra-zone/ui/Icon';
import { InfoIcon } from 'lucide-react';
import { Tooltip } from '@penumbra-zone/ui/Tooltip';
import SpinnerIcon from '@/shared/assets/spinner-icon.svg';
import cn from 'clsx';

export interface OrderInputProps {
  id?: string;
  label: string;
  value: string;
  placeholder?: string;
  isEstimating?: boolean;
  isApproximately?: boolean;
  onChange?: (amount: string, ...args: unknown[]) => void;
  denominator?: string;
  max?: string | number;
  min?: string | number;
  disabled?: boolean;
  decimals?: number;
  round?: boolean;
}

/**
 * The order form input field.
 *
 * Wrapped in memo so when one input on a multi-input form (limit, simple-LP)
 * receives a keystroke, the others — whose props haven't changed — skip
 * re-render entirely. Effective only when callers pass a stable onChange
 * (the bound MobX setter, not a fresh inline wrapper).
 */
const OrderInputImpl = ({
  ref,
  id: idProp,
  label,
  value,
  placeholder,
  isEstimating,
  isApproximately,
  onChange,
  denominator,
  max,
  min,
  disabled,
  decimals,
  round: roundValue = false,
}: OrderInputProps & {
  ref?: React.RefObject<HTMLInputElement>;
}) => {
  const { ref: denomRef, width: denomWidth } = useComponentSize();
  const textRef = useRef<HTMLDivElement>(null);
  const [textWidth, setTextWidth] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const reactId = useId();
  const id = idProp ?? reactId;
  const roundedValue =
    roundValue && !isFocused
      ? round({
          value,
          decimals: decimals ?? 0,
        })
      : value;

  // prevent input from exceeding the specified number of decimals
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const key = parseInt(event.key);
      const decimalPart = roundedValue.split('.')[1] ?? '';
      if (!isNaN(key) && typeof decimals !== 'undefined' && decimalPart.length >= decimals) {
        event.preventDefault();
      }
    },
    [roundedValue, decimals],
  );

  // Stable handlers — without these, every keystroke (or every block-tick
  // re-render of the parent observer form) re-allocates four DOM event
  // listeners per OrderInput. With 3 OrderInputs in the limit form and 4
  // in the range LP form, that adds up quickly. The blur-on-wheel idiom
  // prevents accidental scroll-wheel value changes that browsers ship for
  // type='number'.
  const onChangeInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value),
    [onChange],
  );
  const onFocus = useCallback(() => setIsFocused(true), []);
  const onBlur = useCallback(() => setIsFocused(false), []);
  const onWheel = useCallback(
    (e: WheelEvent<HTMLInputElement>) => (e.target as HTMLInputElement).blur(),
    [],
  );

  // Inline style object would be a fresh literal each render; React's
  // shallow-equal would mark the input dirty even when denomWidth hasn't
  // changed. Memoize on the only piece of data it depends on.
  const inputStyle = useMemo(
    () => ({ paddingRight: denomWidth + 20 }),
    [denomWidth],
  );

  useEffect(() => {
    // useComponentSize doesnt set width correctly on updates, so we
    // measure on the next frame. Cancel any in-flight rAF on cleanup so
    // rapid keystrokes don't pile up multiple pending measurements that
    // all settle to the same value (React bails out the duplicate
    // setStates, but the rAF callbacks themselves are pure overhead).
    const id = requestAnimationFrame(() => {
      setTextWidth(textRef.current?.offsetWidth ?? 0);
    });
    return () => cancelAnimationFrame(id);
  }, [roundedValue]);

  return (
    <div className='relative h-16 rounded-sm bg-linear-to-r from-other-tonal-fill5 to-other-tonal-fill10'>
      <label
        htmlFor={id}
        className='absolute top-2 left-3 z-1 font-default text-text-sm leading-text-xs font-normal text-text-secondary'
      >
        {label}
      </label>
      {isEstimating ? (
        <div className='flex animate-pulse items-center p-2 pt-7 pl-3 text-text-secondary'>
          <div className='mr-1 flex h-6 items-center'>
            <SpinnerIcon className='animate-spin' />
          </div>
          <span className='font-default text-text-sm leading-text-xs font-normal'>
            Estimating...
          </span>
        </div>
      ) : (
        <>
          <div
            ref={textRef}
            className='invisible absolute font-default text-text-lg leading-text-lg font-medium'
          >
            {roundedValue}
          </div>
          <input
            className={cn(
              'w-full appearance-none border-none bg-transparent',
              'rounded-sm text-text-primary transition-colors duration-150',
              'p-2 pt-7',
              isApproximately && roundedValue ? 'pl-7' : 'pl-3',
              'font-default text-text-lg leading-text-lg font-medium',
              !disabled &&
                'hover:bg-other-tonal-fill5 focus:bg-other-tonal-fill10 focus:outline-hidden',
              disabled && 'cursor-not-allowed',
              '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
              "[&[type='number']]:[-moz-appearance:textfield]",
            )}
            style={inputStyle}
            value={roundedValue}
            disabled={disabled}
            onChange={onChangeInput}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            onWheel={onWheel}
            placeholder={placeholder}
            type='number'
            max={max}
            min={min}
            ref={ref}
            id={id}
          />
          {isApproximately && roundedValue && (
            <>
              <span className='absolute top-[27px] left-3 font-default text-text-lg leading-text-lg font-medium text-secondary-light'>
                ≈
              </span>
              <div className='absolute top-[31px]' style={{ left: textWidth + 8 * 4 }}>
                <Tooltip message='Swap outputs are estimates based on current market prices.'>
                  <Icon IconComponent={InfoIcon} size='sm' color='text.primary' />
                </Tooltip>
              </div>
            </>
          )}
        </>
      )}
      {denominator && (
        <div
          ref={denomRef}
          className='pointer-events-none absolute top-0 right-3 z-1 font-default text-text-sm leading-[64px]! leading-text-xs font-normal text-text-secondary'
        >
          {denominator}
        </div>
      )}
    </div>
  );
};

OrderInputImpl.displayName = 'OrderInput';

export const OrderInput = memo(OrderInputImpl);
