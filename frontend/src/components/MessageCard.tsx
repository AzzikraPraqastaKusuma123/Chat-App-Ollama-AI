// frontend/src/components/MessageCard.tsx
import React from 'react';

const SpeakerIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.348 2.595.341 1.24 1.518 1.905 2.66 1.905H6.44l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 12.353a.75.75 0 0 0 0-1.06l-2.121-2.122a.75.75 0 0 0-1.061 1.061L16.563 11H15a.75.75 0 0 0 0 1.5h1.563l-1.16 1.16a.75.75 0 1 0 1.06 1.061l2.122-2.121Z" />
        <path d="M22.5 12c0 3.109-1.895 5.813-4.5 7.064a.75.75 0 1 L18 17.647A7.133 7.133 0 0 1 19.508 12a7.132 7.132 0 0 1-1.508-4.647.75.75 0 0 0-1.061-1.061c.005 0 .005 0 .005-.001A8.636 8.636 0 0 0 18 4.934a.75.75 0 1 0 0 1.416A8.636 8.636 0 0 0 18 19.066c2.605-1.251 4.5-3.955 4.5-7.066Z" />
    </svg>
);

type MessageCardProps = {
    role: "assistant" | "user";
    message: string;
    timestamp: string;
    onPlaySound?: (textOrAudioData: string | any) => void;
    audioData?: any; 
};

export const MessageCard = (props: MessageCardProps) => {
    const isUser = props.role === "user";

    const handlePlaySound = () => {
        if (props.onPlaySound) {
            if (props.audioData) {
                props.onPlaySound(props.audioData);
            } else if (!isUser && props.message) {
                 props.onPlaySound(props.message);
            }
        }
    };

    return (
        <div className={`flex items-end gap-2.5 my-2 w-full group ${isUser ? 'justify-end' : 'justify-start'}`}>
            {!isUser && (
                <div className="flex-shrink-0 w-8 h-8 md:w-9 md:h-9 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-xs md:text-sm font-medium shadow-md transition-transform duration-200 ease-out group-hover:scale-105">
                    A
                </div>
            )}
            <div
                className={`
                    px-3.5 py-2.5 shadow-lg max-w-[70%] sm:max-w-[75%] md:max-w-[70%]
                    transform transition-all duration-200 ease-out group-hover:shadow-xl group-hover:-translate-y-0.5
                    ${isUser
                        ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-l-2xl rounded-tr-2xl rounded-br-lg" 
                        : "bg-white text-slate-700 rounded-r-2xl rounded-tl-2xl rounded-bl-lg border border-gray-200" 
                    }
                `}
            >
                <p className="whitespace-pre-line text-sm leading-relaxed">{props.message}</p>
                <div className={`flex items-center mt-1.5 ${isUser ? 'justify-end' : 'justify-between'}`}>
                    <p className={`text-xs ${isUser ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {props.timestamp}
                    </p>
                    {!isUser && props.onPlaySound && (
                        <button 
                            onClick={handlePlaySound} 
                            className="ml-2 p-1 text-slate-400 hover:text-slate-600 transition-colors duration-150"
                            aria-label="Putar suara pesan"
                        >
                            <SpeakerIcon />
                        </button>
                    )}
                </div>
            </div>
            {isUser && (
                <div className="flex-shrink-0 w-8 h-8 md:w-9 md:h-9 rounded-full bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center text-white text-xs md:text-sm font-medium shadow-md transition-transform duration-200 ease-out group-hover:scale-105">
                    U
                </div>
            )}
        </div>
    );
};